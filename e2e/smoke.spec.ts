import { expect, test } from '@playwright/test';

test.describe('smoke', () => {
  test('boots, renders the 3D scene and runs the simulation without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });

    await page.goto('/');
    await expect(page).toHaveTitle(/Crease/);
    await expect(page.getByTestId('app')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });

    const canvas = page.locator('[data-testid="game-canvas"] canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(300);
    expect(box?.height ?? 0).toBeGreaterThan(200);

    // The fixed-step simulation advances and a delivery gets under way.
    const steps = () => page.evaluate(() => window.__crease?.simSteps?.() ?? 0);
    const first = await steps();
    await expect.poll(steps, { timeout: 10_000 }).toBeGreaterThan(first + 100);
    await expect.poll(() => page.evaluate(() => window.__crease?.phase?.()), { timeout: 10_000 }).toBe('delivery');
    await expect(page.getByTestId('scoreboard')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
