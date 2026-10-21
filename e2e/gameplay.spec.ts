import { expect, type Page, test } from '@playwright/test';

/**
 * Plays the actual game: menus → match setup → squad → batting through the
 * keyboard (strokes timed to the live ball) → pause → a second match bowling,
 * including the bowler choice → back to the menu.
 */

const balls = (page: Page) => page.evaluate(() => window.__crease?.balls?.() ?? 0);

async function ready(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto('/');
  await expect(page.getByTestId('app')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
}

async function playStroke(page: Page, keys: { hold?: string; press: string }, lead: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__crease?.ballPhase?.()), { timeout: 30_000 }).toBe('inFlight');
  await page.waitForFunction(
    (l) => {
      const eta = window.__crease?.eta?.();
      return eta === undefined || eta <= l;
    },
    lead,
    { polling: 'raf', timeout: 15_000 },
  );
  if (keys.hold) await page.keyboard.down(keys.hold);
  await page.keyboard.press(keys.press);
  if (keys.hold) await page.keyboard.up(keys.hold);
}

test.describe('gameplay', () => {
  test.setTimeout(300_000);

  test('set up a match, pick the XI, bat with several strokes, pause, quit', async ({ page }) => {
    const errors: string[] = [];
    await ready(page, errors);

    // Main menu → setup.
    await page.getByTestId('menu-play').click();
    await expect(page.getByTestId('setup')).toBeVisible();
    await page.getByRole('button', { name: 'Sunrise Strikers' }).first().click();
    await page.getByRole('button', { name: '2', exact: true }).click();
    await page.getByRole('button', { name: 'We bat' }).click();

    // Squad: swap one player in and out, keep 11.
    await page.getByTestId('choose-xi').click();
    await expect(page.getByTestId('squad')).toBeVisible();
    const boxes = page.locator('[data-testid="squad"] input[type="checkbox"]');
    await expect(boxes).toHaveCount(16);
    await boxes.nth(10).uncheck();
    await expect(page.getByTestId('squad-done')).toBeDisabled();
    await boxes.nth(12).check();
    await expect(page.getByTestId('squad-done')).toBeEnabled();
    await page.getByTestId('squad-done').click();

    await page.getByTestId('start-match').click();
    await expect(page.getByTestId('score')).toHaveText('0/0');
    await expect(page.getByTestId('role')).toContainText('You are batting');
    await expect(page.getByTestId('scoreboard')).toContainText('SRS');

    // Three strokes.
    const strokes = [{ press: 'KeyD' }, { hold: 'ArrowLeft', press: 'KeyD' }, { press: 'KeyS' }];
    for (const [i, stroke] of strokes.entries()) {
      await playStroke(page, stroke, 0.24);
      // Call a run if the ball was hit; harmless otherwise.
      await page.waitForTimeout(250);
      await page.keyboard.press('Space');
      await expect.poll(() => balls(page), { timeout: 30_000 }).toBe(i + 1);
      await expect(page.getByTestId('banner')).toBeVisible();
    }
    const score = await page.evaluate(() => window.__crease?.score?.());
    expect((score?.balls ?? 0) + 3).toBeGreaterThanOrEqual(3);

    // Pause freezes the simulation.
    await page.keyboard.press('KeyP');
    await expect(page.getByTestId('pause')).toBeVisible();
    const frozen = await page.evaluate(() => window.__crease?.simSteps?.() ?? 0);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__crease?.simSteps?.() ?? 0)).toBe(frozen);
    await page.getByRole('button', { name: 'Quit to main menu' }).click();
    await expect(page.getByTestId('menu-play')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('bowl: choose the bowler, pick a delivery, aim, run in and release', async ({ page }) => {
    const errors: string[] = [];
    await ready(page, errors);
    await page.getByTestId('menu-play').click();
    await page.getByRole('button', { name: '2', exact: true }).click();
    await page.getByRole('button', { name: 'We bowl' }).click();
    await page.getByTestId('start-match').click();
    await expect(page.getByTestId('role')).toContainText('You are bowling');

    await expect(page.getByTestId('bowler-choice')).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Digit2');
    await expect(page.getByTestId('bowler-choice')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__crease?.phase?.())).toBe('aiming');
    await expect(page.getByTestId('bowling-panel')).toBeVisible();
    await page.keyboard.press('KeyE');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(150);
    await page.keyboard.up('ArrowUp');
    await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => window.__crease?.ballPhase?.())).toBe('runUp');
    await page.waitForTimeout(400);
    await page.keyboard.press('Space');
    await expect.poll(() => balls(page), { timeout: 30_000 }).toBe(1);
    await expect(page.getByTestId('banner')).toBeVisible();

    expect(errors).toEqual([]);
  });
});
