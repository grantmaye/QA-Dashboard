import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../src/lib/database';
import { migrate } from '../src/lib/schema';
import { QaService, requireEditor } from '../src/lib/service';
import { createApi } from '../src/lib/graphql';
import { createGraphqlPost } from '../src/lib/graphql-http';
import {
  identityConfig,
  resolveIdentity,
  type IdentityEnvironment,
  type VerifiedPrincipal,
} from '../src/lib/identity';
const localDemo: IdentityEnvironment = { QA_IDENTITY_MODE: 'demo', QA_DEPLOYMENT_MODE: 'local' };
const localAuth: IdentityEnvironment = {
  QA_IDENTITY_MODE: 'authenticated',
  QA_DEPLOYMENT_MODE: 'local',
};
function request(query = '{ currentRole }', headers: Record<string, string> = {}, variables = {}) {
  return new Request('http://localhost:3000/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ query, variables }),
  });
}
function principal(
  workspace: string,
  role: 'OWNER' | 'MEMBER' | 'VIEWER' = 'OWNER',
): VerifiedPrincipal {
  return {
    subject: `subject-${workspace}`,
    activeWorkspaceId: workspace,
    memberships: [{ workspaceId: workspace, role }],
  };
}

test('configuration fails closed, while explicit local demo is independent of production builds', () => {
  for (const env of [
    {},
    { QA_IDENTITY_MODE: 'demo' },
    { QA_DEPLOYMENT_MODE: 'local' },
    { ...localDemo, QA_IDENTITY_MODE: 'DEMO' },
    { ...localDemo, QA_DEPLOYMENT_MODE: 'unknown' },
    { ...localDemo, ENABLE_LIVE_SCANS: 'yes' },
    { ...localDemo, QA_DEPLOYMENT_MODE: 'hosted', ENABLE_LIVE_SCANS: 'false' },
    { ...localDemo, QA_DEPLOYMENT_MODE: 'hosted', ENABLE_LIVE_SCANS: 'true' },
    { ...localAuth, QA_DEPLOYMENT_MODE: 'hosted' },
    { ...localAuth, QA_DEPLOYMENT_MODE: 'hosted', APP_ORIGIN: 'http://qa.example' },
    { ...localAuth, APP_ORIGIN: 'https://qa.example/path' },
    { ...localAuth, APP_ORIGIN: 'https://name:secret@qa.example' },
  ])
    assert.throws(() => identityConfig(env), { status: 503 });
  const productionBuild = { ...localDemo, NODE_ENV: 'production', ENABLE_LIVE_SCANS: 'true' };
  assert.equal(identityConfig(productionBuild).mode, 'demo');
  assert.equal(
    identityConfig({ ...localAuth, QA_DEPLOYMENT_MODE: 'hosted', APP_ORIGIN: 'https://qa.example' })
      .mode,
    'authenticated',
  );
  assert.throws(() => requireEditor('unexpected' as never), /Viewer/);
});

test('missing principal, membership, config and verifier failures reject at HTTP boundary before SQL/body/runner', async (t) => {
  let opened = 0,
    scheduled = 0;
  const logs = t.mock.method(console, 'error', () => {});
  const ws = randomUUID();
  const cases: Array<{
    env: IdentityEnvironment;
    verified?: VerifiedPrincipal | null;
    throws?: boolean;
    status: number;
  }> = [
    { env: {}, status: 503 },
    { env: localAuth, status: 401 },
    { env: localAuth, verified: { ...principal(ws), subject: '' }, status: 401 },
    { env: localAuth, verified: { ...principal(ws), memberships: [] }, status: 403 },
    { env: localAuth, verified: { ...principal(ws), activeWorkspaceId: null }, status: 403 },
    {
      env: localAuth,
      verified: { ...principal(ws), activeWorkspaceId: randomUUID() },
      status: 403,
    },
    {
      env: localAuth,
      verified: {
        ...principal(ws),
        memberships: [...principal(ws).memberships, ...principal(ws).memberships],
      },
      status: 403,
    },
    {
      env: localAuth,
      verified: { ...principal(ws), memberships: [{ workspaceId: ws, role: 'INVALID' as never }] },
      status: 403,
    },
    { env: localAuth, throws: true, status: 503 },
  ];
  for (const item of cases) {
    const post = createGraphqlPost({
      api: createApi(),
      env: () => item.env,
      makeService: async () => {
        opened++;
        throw new Error('Must not reach SQL');
      },
      schedule: () => {
        scheduled++;
      },
      verify: async () => {
        if (item.throws) throw new Error('private-session-token');
        return item.verified ?? null;
      },
    });
    for (const query of [
      '{ dashboard { sites { id } } }',
      'mutation { startScan(siteId:"northstar") { id } }',
    ]) {
      const req = request(query, {
        cookie: `qa-workspace=${ws}`,
        'x-demo-role': 'OWNER',
        'x-user-id': 'owner',
        'x-workspace-id': ws,
      });
      const response = await post(req);
      assert.equal(response.status, item.status);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(req.bodyUsed, false);
      const body = await response.text();
      assert.ok(!body.includes(ws) && !body.includes('private-session-token'));
    }
  }
  assert.equal(opened, 0);
  assert.equal(scheduled, 0);
  assert.equal(logs.mock.calls.length, 0);
  // The route's real default adapter is unconfigured and cannot trust a Bearer or role header.
  const post = createGraphqlPost({
    api: createApi(),
    env: () => localAuth,
    makeService: async () => {
      throw new Error('No SQL');
    },
    schedule: () => {
      throw new Error('No runner');
    },
  });
  assert.equal(
    (
      await post(
        request(undefined, { authorization: 'Bearer not-a-session', 'x-demo-role': 'OWNER' }),
      )
    ).status,
    401,
  );
});

test('demo hints only resolve in explicit demo mode; authenticated identity ignores spoofed cookie and role', async () => {
  const trusted = randomUUID(),
    forged = randomUUID();
  const req = request(undefined, { cookie: `qa-workspace=${forged}`, 'x-demo-role': 'OWNER' });
  assert.deepEqual(await resolveIdentity(req, identityConfig(localDemo)), {
    mode: 'demo',
    workspace: forged,
    role: 'OWNER',
  });
  const resolved = await resolveIdentity(req, identityConfig(localAuth), async () =>
    principal(trusted, 'VIEWER'),
  );
  assert.equal(resolved.workspace, trusted);
  assert.equal(resolved.role, 'VIEWER');
  await assert.rejects(
    resolveIdentity(request(undefined, { 'x-demo-role': 'bogus' }), identityConfig(localDemo)),
    { status: 400 },
  );
  const generated = await resolveIdentity(
    request(undefined, { cookie: 'qa-workspace=not-a-uuid' }),
    identityConfig(localDemo),
  );
  assert.match(generated.workspace, /^[a-f0-9-]{36}$/);
  assert.equal(generated.role, 'OWNER');
});

test('explicit demo preserves Viewer rejection and sets bounded HttpOnly Strict cookies with trusted HTTPS detection', async () => {
  const db = await createDatabase(process.env.TEST_DATABASE_URL);
  await migrate(db);
  const service = new QaService(db);
  const api = createApi();
  const workspace = randomUUID();
  let config = localDemo;
  const post = createGraphqlPost({
    api,
    env: () => config,
    makeService: async () => service,
    schedule: () => {},
  });
  try {
    const viewer = await post(
      request('mutation { startScan(siteId:"northstar") { id } }', {
        cookie: `qa-workspace=${workspace}`,
        'x-demo-role': 'VIEWER',
      }),
    );
    assert.equal((await viewer.json()).errors[0].extensions.code, 'FORBIDDEN');
    const cookie = viewer.headers.get('set-cookie')!;
    for (const piece of [
      `qa-workspace=${workspace}`,
      'HttpOnly',
      'SameSite=Strict',
      'Path=/',
      'Max-Age=604800',
    ])
      assert.ok(cookie.includes(piece));
    assert.ok(!cookie.includes('Secure') && !cookie.includes('Domain='));
    const owner = await post(
      request('{ currentRole dashboard { sites { id } } }', {
        cookie: `qa-workspace=${workspace}`,
      }),
    );
    assert.equal((await owner.json()).data.currentRole, 'OWNER');
    config = { ...localDemo, APP_ORIGIN: 'https://qa.example' };
    const secure = await post(request(undefined, { cookie: `qa-workspace=${workspace}` }));
    assert.match(secure.headers.get('set-cookie')!, /; Secure$/);
    const cross = await post(request(undefined, { origin: 'https://attacker.example' }));
    assert.equal(cross.status, 403);
    assert.equal(cross.headers.get('set-cookie'), null);
  } finally {
    await api.stop();
    await db.close();
  }
});

test('two trusted principals cannot cross-read, triage, enqueue, preflight, retry or expire another workspace through HTTP context', async () => {
  const db = await createDatabase(process.env.TEST_DATABASE_URL);
  await migrate(db);
  const service = new QaService(db);
  const api = createApi();
  const a = randomUUID(),
    b = randomUUID(),
    missing = randomUUID();
  await service.initialize(a);
  await service.initialize(b);
  const foreignSite = await service.addSite(b, 'OWNER', {
    name: 'Other workspace only',
    url: 'https://private-fixture.example',
    mode: 'DEMO',
  });
  const foreignIssue = (await service.dashboard(b)).issues[0];
  const foreignPreflight = await service.enqueuePreflight(b, 'OWNER', { variant: 'BROKEN' });
  await db.query(
    "UPDATE scans SET status='FAILED',error='Controlled fixture failure' WHERE workspace_id=$1 AND id=$2",
    [b, foreignPreflight.id],
  );
  // Any accidental authenticated-mode seeding must fail the request.
  service.initialize = async () => {
    throw new Error('Authenticated requests must never seed');
  };
  let verified = principal(a);
  const scheduled: Array<() => Promise<void>> = [];
  const post = createGraphqlPost({
    api,
    env: () => localAuth,
    verify: async () => verified,
    makeService: async () => service,
    schedule: (work) => {
      scheduled.push(work);
    },
  });
  const call = async (query: string, variables = {}) => {
    const response = await post(
      request(
        query,
        { cookie: `qa-workspace=${b}`, 'x-demo-role': 'OWNER', 'x-workspace-id': b },
        variables,
      ),
    );
    assert.equal(response.headers.get('set-cookie'), null);
    return { status: response.status, body: await response.json() };
  };
  try {
    const own = await call(
      '{ currentRole dashboard { sites { id } issues { id } scans { id } } preflightRuns { id } }',
    );
    assert.equal(own.status, 200);
    assert.equal(own.body.errors, undefined);
    assert.equal(own.body.data.currentRole, 'OWNER');
    assert.ok(!own.body.data.dashboard.sites.some((s: { id: string }) => s.id === foreignSite.id));
    assert.ok(
      !own.body.data.dashboard.issues.some((i: { id: string }) => i.id === foreignIssue.id),
    );
    assert.deepEqual(own.body.data.preflightRuns, []);
    const page = await call('query($site:ID!){issues(siteId:$site){edges{node{id}}}}', {
      site: foreignSite.id,
    });
    assert.deepEqual(page.body.data.issues.edges, []);
    const triage = await call(
      'mutation($id:ID!){updateIssue(id:$id,input:{status:RESOLVED,assigneeId:null,note:"forged"}){id}}',
      { id: foreignIssue.id },
    );
    assert.equal(triage.body.errors[0].extensions.code, 'NOT_FOUND');
    const queue = await call('mutation($id:ID!){startScan(siteId:$id){id}}', {
      id: foreignSite.id,
    });
    assert.equal(queue.body.errors[0].extensions.code, 'NOT_FOUND');
    const retry = await call(
      'mutation($id:ID!){startPreflight(input:{variant:BROKEN,retryOf:$id}){id}}',
      { id: foreignPreflight.id },
    );
    assert.ok(retry.body.errors);
    assert.deepEqual(await service.preflightRuns(a), []);
    const start = await call('mutation{startPreflight(input:{variant:FIXED}){id}}');
    assert.equal(start.body.errors, undefined);
    assert.equal((await service.preflightRuns(a))[0].id, start.body.data.startPreflight.id);
    assert.equal((await service.preflightRuns(b)).length, 1);
    verified = principal(b, 'MEMBER');
    const other = await call('{ currentRole preflightRuns { id } }');
    assert.equal(other.body.data.currentRole, 'MEMBER');
    assert.deepEqual(
      other.body.data.preflightRuns.map((r: { id: string }) => r.id),
      [foreignPreflight.id],
    );
    verified = principal(a, 'VIEWER');
    for (const query of [
      'mutation{startScan(siteId:"northstar"){id}}',
      'mutation{startPreflight(input:{variant:FIXED}){id}}',
      'mutation{addSite(input:{name:"Spoof",url:"https://spoof.example",mode:DEMO}){id}}',
      `mutation{updateIssue(id:"${foreignIssue.id}",input:{status:OPEN,assigneeId:null,note:""}){id}}`,
    ])
      assert.equal((await call(query)).body.errors[0].extensions.code, 'FORBIDDEN');
    assert.notEqual(
      (await service.dashboard(b)).issues.find((i) => i.id === foreignIssue.id)?.note,
      'forged',
    );
    const before = scheduled.length;
    verified = principal(missing);
    const absent = await call('{ dashboard { sites { id } } }');
    assert.equal(absent.status, 403);
    assert.equal(scheduled.length, before);
    assert.deepEqual(await db.query('SELECT id FROM workspaces WHERE id=$1', [missing]), []);
    // A's request-scoped worker must not even expire B's leases.
    await db.query("UPDATE scans SET status='FAILED' WHERE workspace_id=$1 AND status='QUEUED'", [
      a,
    ]);
    const expired = await service.enqueue(b, 'OWNER', foreignSite.id);
    await db.query(
      "UPDATE scans SET status='RUNNING',attempt=3,lease_until=now()-interval '1 minute' WHERE workspace_id=$1 AND id=$2",
      [b, expired.id],
    );
    await scheduled[0]();
    const [untouched] = await db.query<{ status: string }>(
      'SELECT status FROM scans WHERE workspace_id=$1 AND id=$2',
      [b, expired.id],
    );
    assert.equal(untouched.status, 'RUNNING');
  } finally {
    await api.stop();
    await db.close();
  }
});

test('a warmed authenticated handler re-verifies revoked sessions and memberships before body, SQL or scheduling', async (t) => {
  const db = await createDatabase(process.env.TEST_DATABASE_URL);
  await migrate(db);
  const service = new QaService(db);
  const api = createApi();
  const workspace = randomUUID();
  await service.initialize(workspace);
  service.initialize = async () => {
    throw new Error('Authenticated requests must never seed');
  };
  const sql = t.mock.method(db, 'query');
  let verified: VerifiedPrincipal | null = principal(workspace);
  let unavailable = false;
  let verifiedRequests = 0;
  let opened = 0;
  let scheduled = 0;
  const post = createGraphqlPost({
    api,
    env: () => localAuth,
    verify: async () => {
      verifiedRequests++;
      if (unavailable) throw new Error('private-revocation-provider-detail');
      return verified;
    },
    makeService: async () => {
      opened++;
      return service;
    },
    schedule: () => {
      scheduled++;
    },
  });
  const forged = {
    cookie: `qa-workspace=${workspace}`,
    'x-demo-role': 'OWNER',
    authorization: 'Bearer previously-accepted-is-not-authority',
  };
  try {
    const accepted = await post(request('{ currentRole }', forged));
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).data.currentRole, 'OWNER');
    assert.equal(opened, 1);
    assert.equal(scheduled, 1);
    const acceptedSqlCalls = sql.mock.callCount();
    assert.ok(acceptedSqlCalls > 0);
    const cases: Array<{ name: string; verified: VerifiedPrincipal | null; status: number }> = [
      { name: 'session revoked', verified: null, status: 401 },
      {
        name: 'membership removed',
        verified: { ...principal(workspace), memberships: [] },
        status: 403,
      },
      {
        name: 'active workspace no longer granted',
        verified: { ...principal(workspace), memberships: principal(randomUUID()).memberships },
        status: 403,
      },
      {
        name: 'conflicting membership returned',
        verified: {
          ...principal(workspace),
          memberships: [
            ...principal(workspace, 'OWNER').memberships,
            ...principal(workspace, 'VIEWER').memberships,
          ],
        },
        status: 403,
      },
    ];
    for (const scenario of cases) {
      verified = scenario.verified;
      for (const query of [
        '{ dashboard { sites { id } } }',
        'mutation { startScan(siteId:"northstar") { id } }',
      ]) {
        const req = request(query, forged);
        const response = await post(req);
        assert.equal(response.status, scenario.status, scenario.name);
        assert.equal(req.bodyUsed, false, scenario.name);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('set-cookie'), null);
        assert.ok(!(await response.text()).includes(workspace));
        assert.equal(opened, 1, 'Revocation must be checked before reopening SQL');
        assert.equal(
          sql.mock.callCount(),
          acceptedSqlCalls,
          'Revocation must precede every SQL query',
        );
        assert.equal(scheduled, 1, 'Revoked requests must not schedule a worker');
      }
    }
    // A provider outage after an accepted request must not fall back to its old principal.
    verified = principal(workspace);
    unavailable = true;
    const unavailableRequest = request('{ currentRole }', forged);
    const outage = await post(unavailableRequest);
    assert.equal(outage.status, 503);
    assert.equal(unavailableRequest.bodyUsed, false);
    assert.equal(outage.headers.get('cache-control'), 'no-store');
    assert.equal(outage.headers.get('set-cookie'), null);
    assert.ok(!(await outage.text()).includes('private-revocation-provider-detail'));
    assert.equal(opened, 1);
    assert.equal(scheduled, 1);
    assert.equal(sql.mock.callCount(), acceptedSqlCalls);
    // Recovery must use the newly verified role, not the OWNER context that warmed Apollo.
    unavailable = false;
    verified = principal(workspace, 'VIEWER');
    const recovered = await post(request('{ currentRole }', forged));
    assert.equal((await recovered.json()).data.currentRole, 'VIEWER');
    const mutation = await post(
      request('mutation { startScan(siteId:"northstar") { id } }', forged),
    );
    assert.equal((await mutation.json()).errors[0].extensions.code, 'FORBIDDEN');
    assert.equal(verifiedRequests, 12, 'The verifier must run once for every request');
  } finally {
    await api.stop();
    await db.close();
  }
});
