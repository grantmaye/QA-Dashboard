import { test, expect } from '@playwright/test';
test('campaign release: broken evidence, fixed review, persisted history, and viewer rejection', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('link', { name: 'Campaign preflight' }).click();
  await expect(page.getByRole('heading', { name: 'A release needs a trace.' })).toBeVisible();
  await page.getByRole('button', { name: 'Run preflight', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Release blocked', exact: true })).toBeVisible({
    timeout: 60000,
  });
  await page.getByText('No analytics when consent is disabled', { exact: true }).click();
  await expect(
    page.getByText('4 analytics requests were attempted with consent disabled.', { exact: true }),
  ).toBeVisible();
  if (info.project.name === 'desktop')
    await page.screenshot({ path: 'test-results/preflight-blocked.png', fullPage: true });
  await page.getByLabel('02 / Fixed fixture').check();
  await page.getByRole('button', { name: 'Run preflight', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ready for review', exact: true })).toBeVisible({
    timeout: 60000,
  });
  await expect(
    page.getByText('6 of 6 gates passed · 3 analytics requests observed', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^03 form_submit/ }).click();
  await expect(
    page
      .getByRole('region', { name: 'Selected evidence' })
      .or(page.locator('[aria-label="Selected evidence"]')),
  ).toContainText('workshop-signup');
  if (info.project.name === 'desktop')
    await page.screenshot({ path: 'test-results/preflight-ready.png', fullPage: true });
  else await page.screenshot({ path: 'test-results/preflight-mobile.png', fullPage: true });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ready for review' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Run history' }).getByRole('button')).toHaveCount(
    2,
  );
  await page
    .getByRole('region', { name: 'Run history' })
    .getByRole('button', { name: /BLOCKED Broken fixture/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Release blocked' })).toBeVisible();
  await page.getByLabel('Preflight demo role').selectOption('VIEWER');
  await expect(page.getByRole('button', { name: 'Run preflight', exact: true })).toBeDisabled();
  const forbidden = await page.request.post('/api/graphql', {
    headers: { 'X-Demo-Role': 'VIEWER' },
    data: { query: 'mutation { startPreflight(input:{variant:FIXED}) { id } }' },
  });
  expect((await forbidden.json()).errors[0].extensions.code).toBe('FORBIDDEN');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
test('failed history has an honest retry path and loading errors recover', async ({ page }) => {
  const id = '5ab682a9-84a0-45dd-badb-2a99888a11dd';
  let failedLoad = true;
  let retryInput: unknown;
  await page.route('**/api/graphql', async (route) => {
    const body = route.request().postDataJSON();
    if (body.query.includes('mutation Start')) {
      retryInput = body.variables.input;
      await route.fulfill({ json: { errors: [{ message: 'Worker unavailable; retry later.' }] } });
      return;
    }
    if (failedLoad) {
      failedLoad = false;
      await route.fulfill({ status: 503, json: { error: 'Temporary storage failure' } });
      return;
    }
    await route.fulfill({
      json: {
        data: {
          preflightRuns: [
            {
              id,
              status: 'FAILED',
              createdAt: '2026-01-01T12:00:00Z',
              completedAt: '2026-01-01T12:00:01Z',
              error: 'Chromium could not start.',
              attempt: 1,
              input: { variant: 'FIXED', fixtureVersion: 'northstar-1', retryOf: null },
              preflight: null,
            },
          ],
        },
      },
    });
  });
  await page.goto('/preflight');
  await expect(
    page.getByRole('alert').filter({ hasText: /Temporary storage failure|Worker unavailable/ }),
  ).toContainText('Temporary storage failure');
  await page.getByRole('button', { name: 'Retry loading' }).click();
  await expect(page.getByRole('heading', { name: 'Run failed', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry failed run' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: /Temporary storage failure|Worker unavailable/ }),
  ).toContainText('Worker unavailable');
  expect(retryInput).toEqual({ variant: 'FIXED', retryOf: id });
  await expect(page.getByRole('heading', { name: 'Ready for review' })).toHaveCount(0);
});
