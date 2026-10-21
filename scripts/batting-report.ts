/**
 * Batting distribution report. Simulates many strokes per scenario through
 * the real game code (delivery engine → BallInPlay → contact model) and
 * writes docs/batting-report.md.
 *
 *   npm run report:batting
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { TEAMS, findPlayer } from '../src/game/data/teams.ts';
import type { DeliveryPlan } from '../src/game/bowling/execute.ts';
import { type StrokeSummary, mean, rate, simulateMany } from '../src/game/batting/harness.ts';
import { type ShotAttempt, SHOTS, attempt } from '../src/game/batting/shots.ts';
import type { Player } from '../src/game/model/player.ts';

const N = Number(process.env.REPORT_N ?? 200);
const [mariners, rangers] = TEAMS;
if (!mariners || !rangers) throw new Error('sample teams missing');
const quick = findPlayer(mariners, (p) => p.name === 'Sam Adeyemi');
const offie = findPlayer(mariners, (p) => p.name === 'Imran Qadir');
const top = findPlayer(rangers, (p) => p.name === 'Marcus Lyle');
const tail = findPlayer(rangers, (p) => p.name === 'Tariq Aziz');

interface Scenario {
  readonly label: string;
  readonly bowler: Player;
  readonly batter: Player;
  readonly plan: DeliveryPlan;
  readonly shot: ShotAttempt;
  readonly timingMs: number;
}

const s = (label: string, bowler: Player, plan: DeliveryPlan, shot: ShotAttempt, timingMs: number, batter: Player = top): Scenario => ({
  label, bowler, batter, plan, shot, timingMs,
});

const FULL: DeliveryPlan = { type: 'fast', line: 0.25, length: 3.5 };
const GOOD: DeliveryPlan = { type: 'fast', line: 0.1, length: 5.5 };
const SHORT_WIDE: DeliveryPlan = { type: 'fast', line: 0.6, length: 8 };
const BOUNCER: DeliveryPlan = { type: 'bouncer', line: 0, length: 10.5 };
const YORKER: DeliveryPlan = { type: 'yorker', line: 0, length: 0.9 };
const SPIN: DeliveryPlan = { type: 'offBreak', line: 0.1, length: 4 };

const sections: { title: string; note: string; rows: Scenario[] }[] = [
  {
    title: 'Timing: cover drive to a full ball outside off',
    note: 'Same delivery plan and stroke; only timing changes. Quality and exit speed fall away from zero, early drives drag towards mid-off, late ones squirt squarer or take the outside edge.',
    rows: [-60, -30, -15, 0, 15, 30, 60].map((ms) => s(`${ms > 0 ? '+' : ''}${ms} ms`, quick, FULL, attempt('coverDrive'), ms)),
  },
  {
    title: 'Shot selection against one delivery (full, outside off)',
    note: 'Different intentions on the same ball, perfectly timed.',
    rows: (['straightDrive', 'offDrive', 'coverDrive', 'squareCut', 'loftedDrive', 'block', 'pull'] as const).map((id) =>
      s(SHOTS[id].name, quick, FULL, attempt(id), 0),
    ),
  },
  {
    title: 'The right shot for the length',
    note: 'Each delivery played with a suitable and an unsuitable stroke, perfectly timed.',
    rows: [
      s('Good length — block', quick, GOOD, attempt('block'), 0),
      s('Good length — cover drive', quick, GOOD, attempt('coverDrive'), 0),
      s('Short & wide — square cut', quick, SHORT_WIDE, attempt('squareCut'), 0),
      s('Short & wide — cover drive', quick, SHORT_WIDE, attempt('coverDrive'), 0),
      s('Bouncer — pull', quick, BOUNCER, attempt('pull'), 0),
      s('Bouncer — hook', quick, BOUNCER, attempt('hook'), 0),
      s('Bouncer — straight drive', quick, BOUNCER, attempt('straightDrive'), 0),
      s('Yorker — straight drive', quick, YORKER, attempt('straightDrive'), 0),
      s('Yorker — block', quick, YORKER, attempt('block'), 0),
      s('Off-break — sweep', offie, SPIN, attempt('sweep'), 0),
      s('Off-break — lofted drive', offie, SPIN, attempt('loftedDrive'), 0),
      s('Off-break — reverse sweep', offie, SPIN, attempt('reverseSweep'), 0),
    ],
  },
  {
    title: 'Skill: the same 15 ms-late cover drive by a top-order batter and a tailender',
    note: 'Technique and timing attributes narrow the spread of contact and direction.',
    rows: [s('Top order (Marcus Lyle)', quick, FULL, attempt('coverDrive'), 15, top), s('Tailender (Tariq Aziz)', quick, FULL, attempt('coverDrive'), 15, tail)],
  },
];

const pct = (x: number) => `${Math.round(x * 100)}%`;
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '–');

function row(sc: Scenario, xs: StrokeSummary[]): string {
  const struck = xs.filter((x) => x.kind === 'middled' || x.kind === 'mistimed' || x.kind === 'edge');
  const clean = xs.filter((x) => x.kind === 'middled' || x.kind === 'mistimed');
  const dirs = clean.map((x) => x.directionDeg);
  const dirSd = Math.sqrt(mean(dirs.map((d) => (d - mean(dirs)) ** 2)));
  return [
    sc.label,
    pct(rate(xs, (x) => x.kind === 'middled')),
    pct(rate(xs, (x) => x.kind === 'mistimed')),
    pct(rate(xs, (x) => x.kind === 'edge')),
    pct(rate(xs, (x) => x.kind === 'miss')),
    f1(mean(struck.map((x) => x.exitSpeed))),
    clean.length ? `${f1(mean(dirs))}° ± ${f1(dirSd)}` : '–',
    clean.length ? `${f1(mean(clean.map((x) => x.elevationDeg)))}°` : '–',
    pct(rate(xs, (x) => x.end === 'boundary4')),
    pct(rate(xs, (x) => x.end === 'boundary6')),
    pct(rate(xs, (x) => x.airborneChance)),
    pct(rate(xs, (x) => x.end === 'bowled')),
    pct(rate(xs, (x) => x.end === 'pad' || x.end === 'body')),
  ].join(' | ');
}

const header =
  '| Scenario | Middled | Mistimed | Edge | Miss | Exit m/s | Direction (clean) | Elevation | 4 | 6 | Aerial chance | Bowled | Pad/body |\n' +
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';

let md = `# Batting distribution report\n\nGenerated by \`npm run report:batting\` from the game's own simulation code: each row is ${N} simulated deliveries (each with its own execution error) and strokes. "Aerial chance" = the ball was above 0.3 m more than 12 m from the bat before bouncing (a catchable chance, before fielders are modelled). Directions are degrees from straight, positive towards the off side.\n\nThe report shows the shape of the model; it is not evidence of realism by itself.\n`;

for (const sec of sections) {
  md += `\n## ${sec.title}\n\n${sec.note}\n\n${header}\n`;
  for (const sc of sec.rows) {
    const xs = simulateMany({ bowler: sc.bowler, batter: sc.batter, plan: sc.plan, attempt: sc.shot, timingMs: sc.timingMs }, N, `${sc.label}:`);
    md += `| ${row(sc, xs)} |\n`;
  }
}

mkdirSync('docs', { recursive: true });
writeFileSync('docs/batting-report.md', md);
console.log(`Wrote docs/batting-report.md (${N} strokes per row)`);
