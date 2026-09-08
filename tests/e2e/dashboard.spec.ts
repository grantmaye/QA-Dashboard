import { test, expect } from '@playwright/test';
test('scan, triage, persistence, filtering and history', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your websites' })).toBeVisible();
  await page.screenshot({
    path: `test-results/${info.project.name}-dashboard.png`,
    fullPage: true,
  });
  await page.getByLabel('Search issues').fill('no-such-finding');
  await expect(page.getByText('No issues match these filters.')).toBeVisible();
  await page.getByLabel('Search issues').fill('');
  const queuedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/graphql') &&
      response.request().postData()?.includes('mutation Scan') === true,
  );
  await page.getByRole('button', { name: 'Run scan', exact: true }).first().click();
  const queued = await (await queuedResponse).json();
  expect(queued.errors).toBeUndefined();
  const scanId = queued.data.startScan.id;
  await expect
    .poll(
      async () => {
        const response = await page.request.post('/api/graphql', {
          data: { query: '{ dashboard { scans { id status } } }' },
        });
        const result = await response.json();
        return result.data.dashboard.scans.find(
          (scan: { id: string; status: string }) => scan.id === scanId,
        )?.status;
      },
      { timeout: 20000 },
    )
    .toBe('COMPLETED');
  await expect(page.getByRole('button', { name: 'Scanning…' })).toHaveCount(0, { timeout: 30000 });
  await page
    .getByRole('button', { name: /Inspect / })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Issue details' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Status', { exact: true }).selectOption('IN_PROGRESS');
  await dialog.getByLabel('Review note').fill('Check again after the next deployment.');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await page
    .getByRole('button', { name: /Inspect / })
    .first()
    .click();
  await expect(page.getByLabel('Review note')).toHaveValue(
    'Check again after the next deployment.',
  );
  await page.getByRole('button', { name: 'Close issue' }).click();
  await page.getByRole('button', { name: 'Scan history', exact: true }).click();
  await expect(page.getByText('COMPLETED').first()).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Add website', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add website' });
  await add.getByLabel('Name', { exact: true }).fill('Portfolio');
  await add.getByLabel('Website URL').fill('https://portfolio.example');
  await add.getByRole('button', { name: 'Add website' }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio', exact: true })).toBeVisible();
  if (info.project.name === 'desktop') {
    await page.getByLabel('Demo role').selectOption('VIEWER');
    await expect(page.getByRole('button', { name: 'Add website', exact: true })).toBeDisabled();
  }
  await expect(page.locator('.error[role="alert"]')).toHaveCount(0);
});
