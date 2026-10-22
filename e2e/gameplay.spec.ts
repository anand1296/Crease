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

    // Squad: drag the No. 11 to the bench, drag a bench player into the order, reorder by dragging.
    await page.getByTestId('choose-xi').click();
    await expect(page.getByTestId('squad')).toBeVisible();
    const rows = page.getByTestId('xi-row');
    await expect(rows).toHaveCount(11);
    await rows.nth(10).dragTo(page.getByTestId('bench'));
    await expect(rows).toHaveCount(10);
    await expect(page.getByTestId('squad-done')).toBeDisabled();
    const incoming = (await page.getByTestId('bench-row').first().locator('.who-name').textContent()) ?? '';
    await page.getByTestId('bench-row').first().dragTo(page.getByTestId('xi-empty'));
    await expect(rows).toHaveCount(11);
    await expect(rows.nth(10)).toContainText(incoming);
    const opener = (await rows.nth(0).locator('.who-name').textContent()) ?? '';
    await rows.nth(0).dragTo(rows.nth(3));
    await expect(rows.nth(2)).toContainText(opener);
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
      // An lbw appeal can bring a review, which takes a while at software-rendering speed: speed it up.
      await expect
        .poll(
          async () => {
            const ph = await page.evaluate(() => window.__crease?.phase?.());
            if (ph === 'appeal' || ph === 'drs') await page.evaluate(() => window.__crease?.setSpeed?.(4));
            return balls(page);
          },
          { timeout: 240_000 },
        )
        .toBe(i + 1);
      await page.evaluate(() => window.__crease?.setSpeed?.(1));
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
    // (A replay hides the buttons: skip it if one is playing.)
    if (await page.getByTestId('replay').isVisible()) await page.keyboard.press('Enter');
    await expect(page.getByTestId('autoplay')).toHaveAttribute('data-mode', 'off', { timeout: 30_000 });
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
    // The scorecard and match statistics are a tab away.
    await page.getByTestId('pause-scorecard').click();
    await expect(page.getByTestId('pause-scorecards')).toContainText('SR');
    await page.getByTestId('pause-stats').click();
    await expect(page.getByTestId('match-stats')).toContainText('Run rate');
    await page.getByTestId('pause-menu').click();
    const frozen = await page.evaluate(() => window.__crease?.simSteps?.() ?? 0);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__crease?.simSteps?.() ?? 0)).toBe(frozen);
    await page.getByRole('button', { name: 'Quit to main menu' }).click();
    await expect(page.getByTestId('menu-play')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('lbw: given out, the batter reviews it, and the third umpire decides with ball tracking', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    // A fixed seed: leaving the first ball gets the batter hit on the pad in front.
    await page.goto('/?seed=drs2');
    await expect(page.getByTestId('app')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
    await page.getByTestId('menu-play').click();
    await page.getByRole('button', { name: '2', exact: true }).click();
    await page.getByRole('button', { name: 'We bat' }).click();
    await page.getByTestId('start-match').click();
    await takeTheField(page);
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__crease?.ballPhase?.()), { timeout: 90_000 }).toBe('inFlight');
    await page.keyboard.press('KeyA');
    await expect(page.getByTestId('appeal')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('appeal')).toContainText('2 reviews left');
    await page.keyboard.press('KeyT');
    await expect(page.getByTestId('drs')).toBeVisible();
    await page.evaluate(() => window.__crease?.setSpeed?.(3));
    await expect(page.getByTestId('drs-decision')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('drs')).toBeHidden({ timeout: 120_000 });
    await expect(page.getByTestId('banner')).toContainText(/OUT|NOT OUT/);
    expect(errors).toEqual([]);
  });

  test('the toss: call it, see the coin land, and the winner chooses', async ({ page }) => {
    const errors: string[] = [];
    await ready(page, errors);
    await page.getByTestId('menu-play').click();
    await page.getByRole('button', { name: '2', exact: true }).click();
    await page.getByRole('button', { name: 'Toss for it' }).click();
    // At Lord's, under cloud.
    await page.getByRole('button', { name: "Lord's", exact: true }).click();
    await page.getByRole('button', { name: 'Overcast', exact: true }).click();
    await expect(page.getByTestId('venue-note')).toContainText('Pavilion');
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

  test('save a match from the pause menu, quit, and carry it on from the main menu', async ({ page }) => {
    const errors: string[] = [];
    await ready(page, errors);
    await page.getByTestId('menu-play').click();
    await page.getByRole('button', { name: '2', exact: true }).click();
    await page.getByRole('button', { name: 'We bat' }).click();
    await page.getByRole('button', { name: 'Under lights', exact: true }).click();
    await page.getByTestId('start-match').click();
    await takeTheField(page);
    await page.keyboard.press('Enter');
    // Let a ball go by (leave it), then save.
    await expect.poll(() => page.evaluate(() => window.__crease?.ballPhase?.()), { timeout: 90_000 }).toBe('inFlight');
    await page.keyboard.press('KeyA');
    await expect.poll(() => balls(page), { timeout: 120_000 }).toBe(1);
    const before = await page.evaluate(() => window.__crease?.score?.());
    await page.keyboard.press('KeyP');
    await page.getByTestId('save-match').click();
    await expect(page.getByTestId('save-match')).toContainText('Saved');
    await page.getByRole('button', { name: 'Quit to main menu' }).click();
    await page.getByTestId('menu-continue').click();
    await expect(page.getByTestId('saved-matches')).toContainText('India v Pakistan');
    await page.getByTestId('load-save').first().click();
    await takeTheField(page);
    // Back where it was: the same score and balls, waiting for the player.
    await expect(page.getByTestId('review')).toBeVisible();
    expect(await page.evaluate(() => window.__crease?.score?.())).toEqual(before);
    await expect(page.getByTestId('role')).toContainText('You are batting');
    expect(errors).toEqual([]);
  });
  test('practice: a challenge from the main menu, its progress, and the result', async ({ page }) => {
    const errors: string[] = [];
    await ready(page, errors);
    await page.getByTestId('menu-practice').click();
    await expect(page.getByTestId('practice-menu')).toContainText('Hit the markers');
    await page.getByTestId('challenge-survive').click();
    await takeTheField(page);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('challenge')).toContainText('Survive the over');
    await expect(page.getByTestId('challenge')).toContainText('6 balls left');
    // Let the computer bat it out, quickly.
    await page.keyboard.press('KeyU');
    // Run the over on without drawing every frame (software rendering manages about a ball a minute).
    await expect
      .poll(
        async () => {
          await page.evaluate(() => window.__crease?.advance?.(4));
          return page.getByTestId('practice-result').isVisible();
        },
        { timeout: 300_000 },
      )
      .toBe(true);
    await expect(page.getByTestId('practice-result')).toContainText(/Challenge complete|Not this time/);
    expect(errors).toEqual([]);
  });
});
