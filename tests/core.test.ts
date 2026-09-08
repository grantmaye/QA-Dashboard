import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/lib/database';
import { migrate } from '../src/lib/schema';
import { QaService } from '../src/lib/service';
import { scanWebsite, inspectHtml } from '../src/lib/scanner';
import { demoTransport } from '../src/lib/fixtures';
import { publicAddress, validateUrl } from '../src/lib/transport';
import { createApi, contextFor } from '../src/lib/graphql';
test('network policy rejects private, mapped, reserved, credentials and alternate ports', () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '::1',
    '::ffff:127.0.0.1',
    '192.168.1.1',
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('8.8.8.8'), true);
  for (const url of [
    'http://localhost',
    'http://127.1',
    'http://2130706433',
    'http://site.local',
    'file:///etc/passwd',
    'https://user:pass@example.com',
    'https://example.com:3000',
  ])
    assert.throws(() => validateUrl(url));
});
test('HTML checks distinguish decorative alt from absent alt', () => {
  const result = inspectHtml(
    '<html lang="en"><title>Page</title><meta name="description" content="Description"><h1>Main</h1><img src="a" alt=""><img src="b"></html>',
    'https://test.example/',
  );
  assert.deepEqual(
    result.findings.map((f) => f.rule),
    ['MISSING_ALT'],
  );
});
test('sample crawler is deterministic and checks discovered 404', async () => {
  const a = await scanWebsite('https://northstar.example/', demoTransport),
    b = await scanWebsite('https://northstar.example/', demoTransport);
  assert.equal(a.pages.length, 5);
  assert.equal(a.findings.length, 10);
  assert.deepEqual(a.findings, b.findings);
  assert.ok(a.findings.some((f) => f.rule === 'HTTP_ERROR'));
});
test('robots exclusion is respected', async () => {
  const r = await scanWebsite('https://northstar.example/', async (url, origin) =>
    url.endsWith('/robots.txt')
      ? {
          url,
          status: 200,
          html: 'User-agent: *\nDisallow: /about',
          contentType: 'text/plain',
          durationMs: 0,
        }
      : demoTransport(url, origin),
  );
  assert.ok(!r.pages.some((p) => p.url.endsWith('/about')));
  assert.ok(r.warnings.some((w) => w.includes('robots')));
});
test('persistent workflow, isolation, leases, permissions, pagination and batching', async () => {
  const db = await createDatabase(process.env.TEST_DATABASE_URL);
  await migrate(db);
  const service = new QaService(db);
  const workspace = crypto.randomUUID();
  const other = crypto.randomUUID();
  const api = createApi();
  try {
    await service.initialize(workspace);
    await service.initialize(other);
    const original = await service.dashboard(workspace);
    assert.equal(original.issues.length, 30);
    const issue = original.issues[0];
    await service.triage(workspace, 'OWNER', issue.id, {
      status: 'RESOLVED',
      assigneeId: 'grant',
      note: 'Verified in staging',
    });
    await assert.rejects(
      service.triage(other, 'OWNER', issue.id, { status: 'OPEN', assigneeId: null, note: '' }),
    );
    await assert.rejects(service.enqueue(workspace, 'VIEWER', 'northstar'));
    const [a, b] = await Promise.all([
      service.enqueue(workspace, 'OWNER', issue.siteId),
      service.enqueue(workspace, 'MEMBER', issue.siteId),
    ]);
    assert.equal(a.id, b.id);
    assert.equal(await service.runOne(workspace), true);
    const after = await service.dashboard(workspace);
    assert.equal(after.issues.length, 30);
    assert.equal(after.issues.find((i) => i.id === issue.id)?.note, 'Verified in staging');
    assert.equal(after.scans.find((s) => s.id === a.id)?.status, 'COMPLETED');
    const job = await service.enqueue(workspace, 'OWNER', 'northstar');
    await db.query(
      "UPDATE scans SET status='RUNNING',attempt=2,lease_until=now()-interval '1 minute' WHERE workspace_id=$1 AND id=$2",
      [workspace, job.id],
    );
    await service.complete(
      workspace,
      job.id,
      1,
      await scanWebsite('https://northstar.example/', demoTransport),
    );
    assert.equal(
      (await service.dashboard(workspace)).scans.find((s) => s.id === job.id)?.status,
      'RUNNING',
    );
    await service.runOne(workspace);
    assert.equal(
      (await service.dashboard(workspace)).scans.find((s) => s.id === job.id)?.attempt,
      3,
    );
    for (const naive of [true, false]) {
      const c = contextFor(service, workspace, 'OWNER', naive);
      const result = await api.executeOperation(
        { query: '{ dashboard { issues { id assignee { name } } } }' },
        { contextValue: c },
      );
      assert.equal(result.body.kind, 'single');
      if (result.body.kind === 'single') assert.equal(result.body.singleResult.errors, undefined);
      assert.equal(c.metrics.memberQueries, naive ? 30 : 1);
    }
    const c = contextFor(service, workspace);
    const result = await api.executeOperation(
      { query: '{ issues(first: 2) { edges { cursor node { id } } pageInfo { hasNextPage } } }' },
      { contextValue: c },
    );
    if (result.body.kind === 'single') {
      assert.equal(result.body.singleResult.errors, undefined);
      assert.equal(
        (result.body.singleResult.data?.issues as { pageInfo: { hasNextPage: boolean } }).pageInfo
          .hasNextPage,
        true,
      );
    }
  } finally {
    await api.stop();
    await db.close();
  }
});
