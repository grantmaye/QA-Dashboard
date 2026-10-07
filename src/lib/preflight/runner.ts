import { chromium } from 'playwright';
import { campaignFixture, COLLECT_URL, FIXTURE_URL } from './fixture';
import { evaluateEvidence } from './evaluate';
import {
  FIXTURE_VERSION,
  POLICY_VERSION,
  type Observation,
  type PreflightInput,
  type PreflightResult,
} from './model';
export async function runPreflight(input: PreflightInput): Promise<PreflightResult> {
  if (input.fixtureVersion !== FIXTURE_VERSION)
    throw new Error('This fixture version is unavailable; create a new run.');
  if (!['BROKEN', 'FIXED'].includes(input.variant))
    throw new Error('Unsupported controlled fixture.');
  const start = performance.now();
  const timeline: Observation[] = [];
  const browser = await chromium.launch({ headless: true, timeout: 15000 }).catch(() => {
    throw new Error('Chromium could not start. Install the Playwright Chromium runtime and retry.');
  });
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    void browser.close().catch(() => {});
  }, 25000);
  function record(consent: boolean, kind: Observation['kind'], name: string, payload = '') {
    if (timeline.length >= 40) throw new Error('Fixture exceeded the observation limit.');
    timeline.push({
      sequence: timeline.length + 1,
      elapsedMs: Math.round(performance.now() - start),
      consent,
      kind,
      name,
      payload,
    });
  }
  try {
    for (const consent of [true, false]) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        let unexpected = false;
        await context.route('**/*', async (route) => {
          const request = route.request();
          if (
            request.url() === FIXTURE_URL &&
            request.isNavigationRequest() &&
            request.method() === 'GET'
          ) {
            await route.fulfill({
              status: 200,
              contentType: 'text/html',
              body: campaignFixture(input.variant, consent),
            });
          } else if (request.url() === COLLECT_URL && request.method() === 'POST') {
            const payload = request.postData() || '';
            if (payload.length > 4096 || timeline.length >= 40) {
              unexpected = true;
              await route.abort();
              return;
            }
            let name = 'invalid_json';
            try {
              name = String(JSON.parse(payload).name || 'unknown');
            } catch {
              /* evaluated as invalid evidence */
            }
            record(consent, 'EVENT', name, payload);
            await route.fulfill({ status: 204 });
          } else {
            unexpected = true;
            await route.abort();
          }
        });
        // These action boundaries come from completed browser operations, not seeded history.
        await page.goto(FIXTURE_URL);
        await page.getByRole('status').filter({ hasText: 'Fixture ready' }).waitFor();
        record(consent, 'ACTION', 'Page loaded');
        await page.getByLabel('Demo email').fill('demo@example.invalid');
        await page.getByRole('button', { name: 'Reserve a demo seat' }).click();
        await page.getByRole('status').filter({ hasText: 'Demo seat reserved' }).waitFor();
        record(consent, 'ACTION', 'Form submitted');
        if (unexpected) throw new Error('Fixture attempted an unexpected network request.');
      } finally {
        await context.close();
      }
    }
    return {
      ...evaluateEvidence(timeline),
      timeline,
      fixtureVersion: FIXTURE_VERSION,
      policyVersion: POLICY_VERSION,
      browserVersion: browser.version(),
      durationMs: Math.round(performance.now() - start),
    };
  } catch (error) {
    if (timedOut)
      throw new Error(
        'The controlled browser run exceeded its 25-second deadline. Retry the fixture.',
      );
    throw error;
  } finally {
    clearTimeout(deadline);
    await browser.close();
  }
}
