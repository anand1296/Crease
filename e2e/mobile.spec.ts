import { expect, test } from '@playwright/test';

/** A phone, sideways: the touch controls appear, and a ball can be played with them. */
test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

test('on a phone: touch controls, a stroke tapped as the ball arrives', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?seed=touch-e2e');
  await expect(page.getByTestId('app')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
  await expect(page.getByTestId('app')).toHaveClass(/touch/);
  await page.getByTestId('menu-play').tap();
  await page.getByRole('button', { name: '2', exact: true }).tap();
  await page.getByRole('button', { name: 'We bat' }).tap();
  await page.getByTestId('start-match').tap();
  await expect(page.getByTestId('warming')).toBeHidden({ timeout: 120_000 });
  await page.getByTestId('continue-review').tap();
  await page.getByTestId('ready-prompt').tap();
  // The stick and the stroke buttons, with the stroke they will play; no keyboard panel.
  await expect(page.getByTestId('touch-controls')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Front foot:/ })).toBeVisible();
  await expect(page.getByTestId('controls-panel')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__crease?.ballPhase?.()), { timeout: 90_000 }).toBe('inFlight');
  // Slowed right down so the tap lands in time on a software-rendered page.
  await page.evaluate(() => window.__crease?.setSpeed?.(0.05));
  await expect.poll(() => page.evaluate(() => window.__crease?.eta?.() ?? 9), { timeout: 60_000 }).toBeLessThan(0.32);
  await page.getByRole('button', { name: /^Front foot:/ }).tap();
  await page.evaluate(() => window.__crease?.setSpeed?.(3));
  await expect.poll(() => page.evaluate(() => window.__crease?.balls?.() ?? 0), { timeout: 120_000 }).toBe(1);
  // The stroke card says how the tap was timed.
  await expect(page.getByTestId('stroke-card')).toBeVisible();
  await expect(page.getByTestId('stroke-card')).not.toContainText('No shot');
  expect(errors).toEqual([]);
});
