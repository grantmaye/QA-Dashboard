import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../src/lib/database';
import { migrate } from '../src/lib/schema';
import { QaService } from '../src/lib/service';
import { createApi, contextFor } from '../src/lib/graphql';
import { evaluateEvidence } from '../src/lib/preflight/evaluate';
import {
  FIXTURE_VERSION,
  POLICY_VERSION,
  type Observation,
  type PreflightInput,
  type PreflightResult,
} from '../src/lib/preflight/model';
function goodEvidence(): Observation[] {
  const common = {
    schema_version: 1,
    page: '/workshop',
    consent: true,
    utm_source: 'demo',
    utm_medium: 'email',
    utm_campaign: 'autumn-workshop',
  };
  const entries = [
    {
      kind: 'EVENT',
      name: 'page_view',
      consent: true,
      payload: JSON.stringify({ ...common, name: 'page_view' }),
    },
    { kind: 'ACTION', name: 'Page loaded', consent: true, payload: '' },
    {
      kind: 'EVENT',
      name: 'form_submit',
      consent: true,
      payload: JSON.stringify({ ...common, name: 'form_submit', form_id: 'workshop-signup' }),
    },
    {
      kind: 'EVENT',
      name: 'conversion',
      consent: true,
      payload: JSON.stringify({
        ...common,
        name: 'conversion',
        form_id: 'workshop-signup',
        conversion_id: 'demo-seat-001',
        value: 0,
        currency: 'USD',
      }),
    },
    { kind: 'ACTION', name: 'Form submitted', consent: true, payload: '' },
    { kind: 'ACTION', name: 'Page loaded', consent: false, payload: '' },
    { kind: 'ACTION', name: 'Form submitted', consent: false, payload: '' },
  ];
  return entries.map((entry, i) => ({
    ...entry,
    kind: entry.kind as Observation['kind'],
    sequence: i + 1,
    elapsedMs: i * 10,
  }));
}
const result = (): PreflightResult => {
  const timeline = goodEvidence();
  return {
    ...evaluateEvidence(timeline),
    timeline,
    fixtureVersion: FIXTURE_VERSION,
    policyVersion: POLICY_VERSION,
    browserVersion: 'unit-test',
    durationMs: 60,
  };
};
test('evidence rejects missing, duplicate, misordered, malformed, unconsented and unattributed events', () => {
  assert.equal(evaluateEvidence(goodEvidence()).verdict, 'READY');
  for (const mutate of [
    (e: Observation[]) => e.filter((x) => x.name !== 'page_view'),
    (e: Observation[]) => [...e, { ...e[3], sequence: 8 }],
    (e: Observation[]) => [e[3], ...e.filter((_, i) => i !== 3)],
    (e: Observation[]) => e.map((x, i) => (i === 3 ? { ...x, payload: 'not json' } : x)),
    (e: Observation[]) => [...e, { ...e[0], sequence: 8, consent: false }],
    (e: Observation[]) =>
      e.map((x, i) => (i === 0 ? { ...x, payload: x.payload.replace('autumn-workshop', '') } : x)),
    (e: Observation[]) =>
      e.map((x, i) =>
        i === 3 ? { ...x, payload: x.payload.replace('"value":0', '"value":"0"') } : x,
      ),
    (e: Observation[]) => e.filter((x) => x.consent),
  ])
    assert.equal(evaluateEvidence(mutate(goodEvidence())).verdict, 'BLOCKED');
  for (const payload of [
    'null',
    '[]',
    '42',
    '"bad"',
    goodEvidence()[0].payload.replace('"consent":true', '"consent":false'),
  ]) {
    const evidence = goodEvidence();
    evidence[0] = { ...evidence[0], payload };
    assert.equal(evaluateEvidence(evidence).verdict, 'BLOCKED');
  }
  assert.equal(evaluateEvidence([]).verdict, 'BLOCKED');
  const a = evaluateEvidence(goodEvidence());
  const b = evaluateEvidence(goodEvidence().map((x) => ({ ...x, elapsedMs: x.elapsedMs + 50 })));
  assert.equal(a.evidenceHash, b.evidenceHash);
});
test('durable preflight shares the queue while preserving website jobs; failures, retries, isolation and fencing', async () => {
  const db = await createDatabase(process.env.TEST_DATABASE_URL);
  await migrate(db);
  await migrate(db);
  let failing = false;
  const snapshots: PreflightInput[] = [];
  const service = new QaService(db, undefined, async (input) => {
    snapshots.push(input);
    if (failing) throw new Error('Controlled runner failure');
    return result();
  });
  const workspace = randomUUID(),
    other = randomUUID();
  const api = createApi();
  try {
    await service.initialize(workspace);
    await service.initialize(other);
    await assert.rejects(
      service.enqueuePreflight(workspace, 'VIEWER', { variant: 'FIXED' }),
      /Viewer/,
    );
    for (const input of [
      { variant: 'URL' },
      { variant: 'FIXED', url: 'https://example.com' },
      { variant: 'FIXED', retryOf: 'bad' },
    ])
      await assert.rejects(service.enqueuePreflight(workspace, 'OWNER', input));
    const [a, b] = await Promise.all([
      service.enqueuePreflight(workspace, 'OWNER', { variant: 'FIXED' }),
      service.enqueuePreflight(workspace, 'MEMBER', { variant: 'FIXED' }),
    ]);
    assert.equal(a.id, b.id);
    await assert.rejects(
      service.enqueuePreflight(workspace, 'OWNER', { variant: 'BROKEN' }),
      /already active/,
    );
    const web = await service.enqueue(workspace, 'OWNER', 'northstar');
    assert.notEqual(web.id, a.id);
    await Promise.all([service.runOne(workspace), service.runOne(workspace)]);
    assert.equal(snapshots.length, 1);
    const completed = (await service.preflightRuns(workspace))[0];
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(completed.preflight?.verdict, 'READY');
    assert.equal((await service.preflightRuns(other)).length, 0);
    const dashboard = await service.dashboard(workspace);
    assert.equal(dashboard.issues.length, 30);
    assert.equal(dashboard.scans.find((x) => x.id === web.id)?.status, 'COMPLETED');
    assert.ok(!dashboard.scans.some((x) => x.id === a.id));
    failing = true;
    const failed = await service.enqueuePreflight(workspace, 'OWNER', { variant: 'BROKEN' });
    await service.runOne(workspace);
    assert.equal(
      (await service.preflightRuns(workspace)).find((x) => x.id === failed.id)?.status,
      'FAILED',
    );
    await assert.rejects(
      service.enqueuePreflight(other, 'OWNER', { variant: 'BROKEN', retryOf: failed.id }),
    );
    await assert.rejects(
      service.enqueuePreflight(workspace, 'OWNER', { variant: 'FIXED', retryOf: failed.id }),
    );
    await assert.rejects(
      service.enqueuePreflight(workspace, 'OWNER', { variant: 'FIXED', retryOf: a.id }),
    );
    failing = false;
    const retry = await service.enqueuePreflight(workspace, 'OWNER', {
      variant: 'BROKEN',
      retryOf: failed.id,
    });
    await db.query(
      "UPDATE scans SET status='RUNNING',attempt=2,lease_until=now()-interval '1 minute' WHERE workspace_id=$1 AND id=$2",
      [workspace, retry.id],
    );
    await service.completePreflight(workspace, retry.id, 1, result());
    assert.equal(
      (await service.preflightRuns(workspace)).find((x) => x.id === retry.id)?.status,
      'RUNNING',
    );
    await service.runOne(workspace);
    assert.equal(
      (await service.preflightRuns(workspace)).find((x) => x.id === retry.id)?.attempt,
      3,
    );
    assert.equal(snapshots.at(-1)?.retryOf, failed.id);
    assert.equal(snapshots.at(-1)?.variant, 'BROKEN');
    assert.equal(
      (await service.preflightRuns(workspace)).find((x) => x.id === failed.id)?.preflight,
      null,
    );
    const exhausted = await service.enqueuePreflight(workspace, 'OWNER', { variant: 'FIXED' });
    await db.query(
      "UPDATE scans SET status='RUNNING',attempt=3,lease_until=now()-interval '1 minute' WHERE workspace_id=$1 AND id=$2",
      [workspace, exhausted.id],
    );
    await service.runOne(workspace);
    assert.equal(
      (await service.preflightRuns(workspace)).find((x) => x.id === exhausted.id)?.status,
      'FAILED',
    );
    await service.completePreflight(workspace, exhausted.id, 3, result());
    assert.equal(
      (await service.preflightRuns(workspace)).find((x) => x.id === exhausted.id)?.status,
      'FAILED',
    );
    const res = await api.executeOperation(
      { query: 'mutation { startPreflight(input:{variant:FIXED}) { id } }' },
      { contextValue: contextFor(service, workspace, 'VIEWER') },
    );
    if (res.body.kind === 'single')
      assert.equal(res.body.singleResult.errors?.[0].extensions?.code, 'FORBIDDEN');
    const read = await api.executeOperation(
      {
        query: '{ preflightRuns { id input { variant } preflight { verdict gates { passed } } } }',
      },
      { contextValue: contextFor(service, workspace) },
    );
    if (read.body.kind === 'single') {
      assert.equal(read.body.singleResult.errors, undefined);
      assert.ok(read.body.singleResult.data?.preflightRuns);
    }
    for (let i = 0; i < 31; i++) {
      await service.enqueuePreflight(workspace, 'OWNER', { variant: 'FIXED' });
      await service.runOne(workspace);
    }
    assert.equal((await service.preflightRuns(workspace)).length, 30);
    assert.equal((await service.dashboard(workspace)).issues.length, 30);
  } finally {
    await api.stop();
    await db.close();
  }
});

test('existing website data survives the additive queue upgrade', async () => {
  const db = await createDatabase();
  try {
    await migrate(db);
    const service = new QaService(db);
    const workspace = randomUUID();
    await service.initialize(workspace);
    const before = await service.dashboard(workspace);
    // Reconstruct the previous schema inside this disposable embedded test database only.
    await db.query('DROP INDEX one_active_job_kind');
    await db.query('ALTER TABLE scans DROP COLUMN kind, DROP COLUMN input, DROP COLUMN preflight');
    await db.query(
      `CREATE UNIQUE INDEX one_active_scan ON scans(workspace_id,site_id) WHERE status IN ('QUEUED','RUNNING')`,
    );
    await migrate(db);
    const after = await service.dashboard(workspace);
    assert.deepEqual(after.issues, before.issues);
    assert.deepEqual(after.sites, before.sites);
    assert.equal(after.scans.length, before.scans.length);
    assert.ok(after.scans.every((s) => s.kind === 'WEBSITE'));
    await service.enqueue(workspace, 'OWNER', 'northstar');
    await service.runOne(workspace);
    assert.equal((await service.dashboard(workspace)).issues.length, 30);
  } finally {
    await db.close();
  }
});
