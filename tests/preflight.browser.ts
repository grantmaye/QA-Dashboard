import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPreflight } from '../src/lib/preflight/runner';
import { FIXTURE_VERSION } from '../src/lib/preflight/model';
test('real Chromium observes broken and fixed landing-page journeys without external collection', async () => {
  const broken = await runPreflight({
    variant: 'BROKEN',
    fixtureVersion: FIXTURE_VERSION,
    retryOf: null,
  });
  assert.equal(broken.verdict, 'BLOCKED');
  assert.equal(broken.timeline.filter((x) => x.kind === 'EVENT').length, 8);
  for (const id of ['schema', 'campaign', 'conversion', 'order', 'consent'])
    assert.equal(broken.gates.find((g) => g.id === id)?.passed, false, id);
  assert.equal(broken.gates.find((g) => g.id === 'journey')?.passed, true);
  const fixed = await runPreflight({
    variant: 'FIXED',
    fixtureVersion: FIXTURE_VERSION,
    retryOf: null,
  });
  assert.equal(fixed.verdict, 'READY');
  assert.equal(fixed.timeline.filter((x) => x.kind === 'EVENT').length, 3);
  assert.ok(fixed.gates.every((g) => g.passed));
  assert.ok(!fixed.timeline.some((x) => x.kind === 'EVENT' && !x.consent));
  const repeat = await runPreflight({
    variant: 'FIXED',
    fixtureVersion: FIXTURE_VERSION,
    retryOf: null,
  });
  assert.equal(fixed.evidenceHash, repeat.evidenceHash);
  assert.ok(!JSON.stringify(fixed.timeline).includes('demo@example.invalid'));
  await assert.rejects(
    runPreflight({ variant: 'FIXED', fixtureVersion: 'unknown', retryOf: null }),
    /version/,
  );
});
