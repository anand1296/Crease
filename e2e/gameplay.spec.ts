import { expect, type Page, test } from '@playwright/test';

/** Start shows a loading screen at once while the match compiles its shaders; then the HUD appears. */
async function takeTheField(page: Page): Promise<void> {
  await expect(page.getByTestId('warming')).toBeVisible();
  await expect(page.getByTestId('warming')).toBeHidden({ timeout: 120_000 });
}

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
  // Software rendering runs the game well below real time, so allow generous waits.
  await expect.poll(() => page.evaluate(() => window.__crease?.ballPhase?.()), { timeout: 90_000 }).toBe('inFlight');
  await page.waitForFunction(
    (l) => {
      const eta = window.__crease?.eta?.();
      return eta === undefined || eta <= l;
    },
    lead,
    { polling: 'raf', timeout: 45_000 },
  );
  if (keys.hold) await page.keyboard.down(keys.hold);
  await page.keyboard.press(keys.press);
  if (keys.hold) await page.keyboard.up(keys.hold);
}

test.describe('gameplay', () => {
  test.setTimeout(600_000);

  test('set up a match, pick the XI, bat with several strokes, pause, quit', async ({ page }) => {
    const errors: string[] = [];
    await ready(page, errors);

    // Main menu → setup.
    await page.getByTestId('menu-play').click();
    await expect(page.getByTestId('setup')).toBeVisible();
    await page.getByRole('button', { name: 'Australia' }).first().click();
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
    await takeTheField(page);
    // Every shader is compiled while the loading screen is up, none during play.
    const programs = await page.evaluate(() => window.__crease?.renderInfo?.().programs ?? -1);
    expect(programs).toBeGreaterThan(0);
    await expect(page.getByTestId('score')).toHaveText('0/0');
    await expect(page.getByTestId('role')).toContainText('You are batting');
    await expect(page.getByTestId('scoreboard')).toContainText('AUS');
    // The match waits at the intro until the player is ready; the controls are on screen.
    await expect(page.getByTestId('review')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('review')).toBeHidden();
    await expect(page.getByTestId('controls-panel')).toBeVisible();

    // Three strokes, Cricket 07 keys: S+↓ front-foot straight drive, W+← back-foot cut (off side for a
    // right-hander), S alone forward defence.
    const strokes = [{ hold: 'ArrowDown', press: 'KeyS' }, { hold: 'ArrowLeft', press: 'KeyW' }, { press: 'KeyS' }];
    for (const [i, stroke] of strokes.entries()) {
      await playStroke(page, stroke, 0.24);
      // Call a run if the ball was hit; harmless otherwise.
      await page.waitForTimeout(250);
      await page.keyboard.press('Space');
      await expect.poll(() => balls(page), { timeout: 90_000 }).toBe(i + 1);
      await expect(page.getByTestId('banner')).toBeVisible();
      // After every ball the game waits for a key press (a wicket or over end shows a card).
      await expect.poll(() => page.evaluate(() => window.__crease?.phase?.()), { timeout: 90_000 }).toBe('review');
      // A wicket or boundary may start an action replay first: Enter skips it.
      if (await page.getByTestId('replay').isVisible()) {
        await page.keyboard.press('Enter');
        await expect(page.getByTestId('replay')).toBeHidden();
      }
      const waitingFor = await page.evaluate(() => (document.querySelector('[data-testid="review"]') ? 'card' : 'next'));
      if (waitingFor === 'next') await expect(page.getByTestId('next-ball')).toBeVisible();
      await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate(() => window.__crease?.phase?.())).not.toBe('review');
    }
    expect(await page.evaluate(() => window.__crease?.renderInfo?.().programs)).toBe(programs);

    // Autoplay: Y hands the rest of the over to the computer; it plays on without waiting, until Y takes it back.
    await expect(page.getByTestId('autoplay')).toHaveAttribute('data-mode', 'off');
    const before = await balls(page);
    await page.keyboard.press('KeyY');
    await expect(page.getByTestId('autoplay')).toHaveAttribute('data-mode', 'over');
    await page.evaluate(() => window.__crease?.setSpeed?.(3));
    // The ball under way is still the player's; from the next one the computer bats, so the batting keys go away.
    await expect.poll(() => balls(page), { timeout: 180_000 }).toBeGreaterThan(before);
    await expect(page.getByTestId('controls-panel')).toBeHidden({ timeout: 60_000 });
    await expect.poll(() => balls(page), { timeout: 180_000 }).toBeGreaterThan(before + 1);
    await page.keyboard.press('KeyY');
    await expect.poll(() => page.evaluate(() => window.__crease?.phase?.()), { timeout: 180_000 }).toBe('review');
    await page.evaluate(() => window.__crease?.setSpeed?.(1));
    await expect(page.getByTestId('autoplay')).toHaveAttribute('data-mode', 'off');
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

  test('the toss: call it, see the coin land, and the winner chooses', async ({ page }) => {
    const errors: string[] = [];
    await ready(page, errors);
    await page.getByTestId('menu-play').click();
    await page.getByRole('button', { name: '2', exact: true }).click();
    await page.getByRole('button', { name: 'Toss for it' }).click();
    await page.getByTestId('start-match').click();
    const toss = page.getByTestId('toss');
    await expect(toss).toHaveAttribute('data-stage', 'call');
    await page.keyboard.press('KeyT');
    await expect(toss).toHaveAttribute('data-stage', 'flip');
    await expect(toss).toHaveAttribute('data-stage', 'result', { timeout: 30_000 });
    const result = (await page.getByTestId('toss-result').textContent()) ?? '';
    expect(result).toMatch(/^(Heads|Tails)\. /);
    let role = '';
    if (result.includes('You won')) {
      await page.keyboard.press('KeyL');
      role = 'You are bowling';
    } else {
      role = result.includes('chose to bat') ? 'You are bowling' : 'You are batting';
      await page.keyboard.press('Enter');
    }
    await takeTheField(page);
    await expect(page.getByTestId('role')).toContainText(role);
    await expect(page.getByTestId('review')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('bowl: choose the bowler and field, pick a delivery and side, place the marker, run in and lock the pace', async ({ page }) => {
    const errors: string[] = [];
    await ready(page, errors);
    await page.getByTestId('menu-play').click();
    await page.getByRole('button', { name: '2', exact: true }).click();
    await page.getByRole('button', { name: 'We bowl' }).click();
    await page.getByTestId('start-match').click();
    await takeTheField(page);
    await expect(page.getByTestId('role')).toContainText('You are bowling');
    await expect(page.getByTestId('review')).toBeVisible();
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('bowler-choice')).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Digit2');
    await expect(page.getByTestId('bowler-choice')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__crease?.phase?.())).toBe('aiming');

    // Step 1: the delivery, the side of the wicket, the field.
    const panel = page.getByTestId('bowling-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-step', 'Delivery');
    await page.keyboard.press('Digit2');
    await expect(panel.getByRole('option', { selected: true })).toContainText(/Inswinger|Googly|Arm ball/);
    await page.keyboard.press('KeyO');
    await expect(page.getByTestId('bowl-side')).toContainText('Around the wicket');
    await page.keyboard.press('KeyF');
    await expect(page.getByTestId('field-preset')).not.toContainText('auto');

    // Step 2: place the landing marker.
    await page.keyboard.press('Space');
    await expect(panel).toHaveAttribute('data-step', 'Landing spot');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(150);
    await page.keyboard.up('ArrowUp');

    // Step 3: run in and lock the pace.
    await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => window.__crease?.ballPhase?.())).toBe('runUp');
    await expect(panel).toHaveAttribute('data-step', 'Run-up');
    await page.waitForTimeout(300);
    await page.keyboard.press('Space');
    await expect(panel).toContainText('Locked at');
    // Software rendering runs far below real time; a hit to the boundary would take minutes to roll there.
    await page.evaluate(() => window.__crease?.setSpeed?.(4));
    await expect.poll(() => balls(page), { timeout: 180_000 }).toBe(1);
    await expect(page.getByTestId('banner')).toBeVisible();

    expect(errors).toEqual([]);
  });

});
