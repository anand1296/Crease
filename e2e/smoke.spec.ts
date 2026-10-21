import { expect, test } from '@playwright/test';

test.describe('P0 smoke', () => {
  test('boots, renders the 3D scene and runs the simulation without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });

    await page.goto('/');
    await expect(page).toHaveTitle(/Crease/);

    const app = page.getByTestId('app');
    await expect(app).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });

    const canvas = page.locator('[data-testid="game-canvas"] canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(300);
    expect(box?.height ?? 0).toBeGreaterThan(200);

    // The fixed-step simulation advances and the ball actually moves.
    const read = () =>
      page.evaluate(() => ({
        steps: window.__crease?.simSteps?.() ?? 0,
        z: window.__crease?.ballPosition?.().z ?? Number.NaN,
        delivery: window.__crease?.deliveryIndex?.() ?? -1,
      }));
    const first = await read();
    await expect.poll(async () => (await read()).steps, { timeout: 10_000 }).toBeGreaterThan(first.steps + 100);
    await expect
      .poll(async () => {
        const now = await read();
        return now.z !== first.z || now.delivery !== first.delivery;
      })
      .toBe(true);

    await expect(page.getByText('CREASE')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
