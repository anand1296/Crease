import { expect, test } from '@playwright/test';

test('boots to the main menu over the 3D stadium without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto('/');
  await expect(page).toHaveTitle(/Crease/);
  await expect(page.getByTestId('app')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
  const canvas = page.locator('[data-testid="game-canvas"] canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(300);
  await expect(page.getByTestId('menu-play')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Crease' })).toBeVisible();
  expect(errors).toEqual([]);
});
