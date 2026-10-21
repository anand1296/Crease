import { expect, type Page, test } from '@playwright/test';

/**
 * Plays the actual game through the keyboard. Strokes are timed from the
 * ball's live ETA (exposed read-only for tests), so these exercise the real
 * input → simulation → scoring → HUD path.
 */

async function waitForInFlight(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__crease?.ballPhase?.()), { timeout: 20_000 }).toBe('inFlight');
}

/** Waits until the ball is `lead` seconds from the bat, then presses the stroke. */
async function playStroke(page: Page, keys: { hold?: string; press: string }, lead: number): Promise<void> {
  await waitForInFlight(page);
  await page.waitForFunction((l) => {
    const eta = window.__crease?.eta?.();
    return eta === undefined || eta <= l;
  }, lead, { polling: 'raf', timeout: 10_000 });
  if (keys.hold) await page.keyboard.down(keys.hold);
  await page.keyboard.press(keys.press);
  if (keys.hold) await page.keyboard.up(keys.hold);
}

const balls = (page: Page) => page.evaluate(() => window.__crease?.balls?.() ?? 0);

test.describe('gameplay', () => {
  test.setTimeout(300_000);

  test('bat several balls with different strokes; score and HUD update; then bowl, pause and restart', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });

    await page.goto('/');
    await expect(page.getByTestId('app')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
    await expect(page.getByTestId('score')).toHaveText('0/0');
    await expect(page.getByTestId('role')).toContainText('You are batting');

    // --- Batting: four balls, four different strokes ---
    const strokes = [
      { press: 'KeyD' }, // straight drive
      { hold: 'ArrowLeft', press: 'KeyD' }, // cover drive (off side for a right-hander)
      { press: 'KeyS' }, // dead-bat defence
      { hold: 'ArrowUp', press: 'KeyA' }, // lofted drive
    ];
    const headlines: string[] = [];
    let ballZ: number[] = [];
    const moved: boolean[] = [];
    for (const [i, stroke] of strokes.entries()) {
      await playStroke(page, stroke, 0.24);
      // The ball moves after the stroke.
      ballZ = [];
      // Sampled across real time: software rendering in CI can run at only a few frames per second.
      for (let k = 0; k < 3; k++) {
        ballZ.push((await page.evaluate(() => window.__crease?.ballPosition?.().z ?? 0)) ?? 0);
        await page.waitForTimeout(250);
      }
      moved.push(new Set(ballZ).size > 1);
      await expect.poll(() => balls(page), { timeout: 20_000 }).toBe(i + 1);
      await expect(page.getByTestId('banner')).toBeVisible();
      headlines.push((await page.evaluate(() => window.__crease?.lastHeadline?.())) ?? '');
    }
    expect(moved.some(Boolean)).toBe(true);
    // At least one stroke made contact (not every ball left, missed or beaten).
    expect(headlines.some((h) => !['Left alone', 'Beaten!'].includes(h))).toBe(true);
    // Scoreboard reflects the balls bowled (no-balls do not count, so ≤ 4).
    const score = await page.evaluate(() => window.__crease?.score?.());
    expect(score?.balls ?? 0).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId('overs')).not.toHaveText('0.0 ov');

    // --- Pause and resume ---
    await page.keyboard.press('KeyP');
    await expect(page.getByTestId('pause')).toBeVisible();
    const frozen = await page.evaluate(() => window.__crease?.simSteps?.() ?? 0);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__crease?.simSteps?.() ?? 0)).toBe(frozen);
    await page.keyboard.press('KeyP');
    await expect(page.getByTestId('pause')).toBeHidden();

    // --- Bowling: switch role, pick a delivery, aim, run in, release ---
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('role')).toContainText('You are bowling');
    await expect(page.getByTestId('score')).toHaveText('0/0');
    await expect.poll(() => page.evaluate(() => window.__crease?.phase?.()), { timeout: 10_000 }).toBe('aiming');
    await expect(page.getByTestId('bowling-panel')).toBeVisible();
    await page.keyboard.press('KeyE');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(150);
    await page.keyboard.up('ArrowUp');
    await page.keyboard.press('Space'); // run in
    await expect.poll(() => page.evaluate(() => window.__crease?.ballPhase?.())).toBe('runUp');
    await page.waitForTimeout(400);
    await page.keyboard.press('Space'); // release
    await expect.poll(() => balls(page), { timeout: 20_000 }).toBe(1);
    await expect(page.getByTestId('banner')).toBeVisible();

    // --- Restart ---
    await page.keyboard.press('KeyR');
    await expect.poll(() => balls(page)).toBe(0);
    await expect(page.getByTestId('score')).toHaveText('0/0');

    expect(errors).toEqual([]);
  });
});
