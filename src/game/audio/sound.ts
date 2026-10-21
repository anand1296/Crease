/**
 * Sound effects synthesised with the Web Audio API: no audio files, so
 * nothing can fail to load and there is nothing to license. Audio starts on
 * the first user gesture (browser autoplay rules) and can be muted; if Web
 * Audio is unavailable every call is a silent no-op.
 *
 * There is no continuous background bed: the ground is quiet between balls,
 * and the crowd is heard only when something happens.
 *
 * Bat on ball is a small physical model rendered sample by sample (see
 * `renderBatHit`): a ~1 ms contact pulse, the crack it radiates, the short
 * woody ring of the blade, and the bat's bending modes (≈140 / 460 / 700 Hz,
 * after Russell's measurements of wooden bats), which a sweet-spot hit
 * barely excites and a hit near the toe or the splice sets humming.
 * Everything then passes through a synthetic "open stadium" reverb so the
 * sound carries round the ground as it does on a broadcast.
 */
const MUTE_KEY = 'crease.muted';

function audioCtor(): typeof AudioContext | undefined {
  return typeof AudioContext === 'undefined' ? undefined : AudioContext;
}

function readMuted(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Small deterministic PRNG for sound texture (the project avoids Math.random). */
class Noise {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    // xorshift32 → [-1, 1)
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return (this.s / 0x100000000) * 2 - 1;
  }
  unit(): number {
    return (this.next() + 1) / 2;
  }
}

export interface BatHit {
  /** 0–1 contact quality (timing and position). */
  readonly quality: number;
  /** Exit speed of the ball, m/s. */
  readonly speed: number;
  /** Thin nick off the edge. */
  readonly edge: boolean;
  /** Metres from the sweet spot along the blade (+ towards the handle) and across the face. */
  readonly along: number;
  readonly across: number;
}

interface Mode {
  f: number;
  amp: number;
  /** Seconds for the mode to fall by 60 dB. */
  t60: number;
}

/**
 * Renders one bat-ball impact as mono samples. Pure function of its inputs
 * (plus a seed for texture), so it can be unit-tested.
 */
export function renderBatHit(hit: BatHit, sampleRate: number, seed: number): Float32Array {
  const rnd = new Noise(seed);
  const loud = Math.min(1, 0.25 + hit.speed / 40);
  // How far from the sweet spot, 0 (middle) … 1 (toe, splice or edge).
  const offAlong = Math.min(1, Math.abs(hit.along) / 0.16);
  const offAcross = Math.min(1, Math.abs(hit.across) / 0.05);
  const off = hit.edge ? 1 : Math.min(1, Math.hypot(offAlong, offAcross * 0.6) + (1 - hit.quality) * 0.35);
  // Contact time: a middled drive ≈ 0.9 ms; a thick, off-centre hit is longer and softer; an edge is a brief tick.
  const contact = hit.edge ? 0.0005 : 0.0008 + 0.0006 * off;
  const detune = 1 + rnd.next() * 0.025;

  const modes: Mode[] = [];
  if (hit.edge) {
    // A nick: torsion of the blade and the bright click of the ball on the edge.
    modes.push({ f: 1150 * detune, amp: 0.35, t60: 0.05 }, { f: 2900 * detune, amp: 0.5, t60: 0.03 }, { f: 4300 * detune, amp: 0.3, t60: 0.02 });
  } else {
    // Woody "tock" of the blade (thickness / plate modes): strong and short when middled.
    const tock = 0.65 + 0.35 * (1 - off);
    modes.push(
      { f: 980 * detune, amp: 0.7 * tock, t60: 0.05 },
      { f: 1520 * detune, amp: 0.85 * tock, t60: 0.04 },
      { f: 2240 * detune, amp: 0.55 * tock, t60: 0.03 },
      { f: 3150 * detune, amp: 0.3 * tock, t60: 0.02 },
    );
    // Bending modes: hardly excited at the sweet spot, a dull jarring hum off it.
    const bend = off * off;
    modes.push(
      { f: 142 * detune, amp: 0.45 * bend, t60: 0.14 },
      { f: 465 * detune, amp: 0.45 * bend, t60: 0.1 },
      { f: 705 * detune, amp: 0.35 * bend, t60: 0.07 },
    );
    // The leather-and-cork ball itself: a brief, hard knock.
    modes.push({ f: 3600 * detune, amp: 0.18, t60: 0.012 });
  }

  const length = Math.ceil(sampleRate * 0.35);
  const out = new Float32Array(length);
  const contactSamples = Math.max(2, Math.round(contact * sampleRate));

  // Half-sine force pulse; its spectrum weights each mode (a longer contact drives less treble).
  const pulseWeight = (f: number) => {
    const x = f * contact;
    // |F(f)| of a half-sine pulse, normalised to 1 at f = 0.
    const d = 1 - 4 * x * x;
    return Math.abs(d) < 1e-3 ? Math.PI / 4 : Math.abs(Math.cos(Math.PI * x) / d);
  };

  for (const m of modes) {
    const w = 2 * Math.PI * m.f;
    const decay = Math.log(1000) / m.t60;
    const a = m.amp * (0.25 + 0.75 * pulseWeight(m.f));
    const phase = rnd.unit() * 0.3;
    const n = Math.min(length, Math.ceil(m.t60 * 1.2 * sampleRate));
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      // Soft onset over the contact time so the ring starts as the ball is on the face.
      const onset = i < contactSamples ? Math.sin((Math.PI / 2) * (i / contactSamples)) : 1;
      out[i] = (out[i] ?? 0) + a * onset * Math.exp(-decay * t) * Math.sin(w * t + phase);
    }
  }

  // The crack: the pressure pulse radiated by the impact (derivative of the force), with a little grain.
  const crackLevel = (hit.edge ? 0.35 : 0.9 * (0.6 + 0.4 * (1 - off))) * 1.6;
  const crackLen = contactSamples * 6;
  for (let i = 0; i < crackLen && i < length; i++) {
    const u = i / contactSamples;
    const pulse = u < 1 ? Math.cos(Math.PI * u) : 0; // derivative of a half-sine: + then −
    const grain = rnd.next() * Math.exp(-i / (contactSamples * 1.5));
    out[i] = (out[i] ?? 0) + crackLevel * (pulse * 0.8 + grain * 0.5);
  }

  // Normalise and apply loudness.
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(out[i] ?? 0));
  const gain = peak > 0 ? (0.9 * loud * (hit.edge ? 0.55 : 1)) / peak : 0;
  for (let i = 0; i < length; i++) out[i] = (out[i] ?? 0) * gain;
  return out;
}

class SoundEngine {
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  /** Dry path and the stadium reverb send. */
  private dry: GainNode | undefined;
  private wet: GainNode | undefined;
  private noise: AudioBuffer | undefined;
  private hits = 1;
  muted = readMuted();

  /** Call from a user gesture; safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = audioCtor();
        if (!Ctor) return;
        const ctx = new Ctor();
        this.ctx = ctx;
        const master = ctx.createGain();
        master.gain.value = this.muted ? 0 : 0.9;
        // A gentle limiter so a big hit and a roar together never clip.
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -10;
        comp.ratio.value = 6;
        comp.attack.value = 0.002;
        comp.release.value = 0.15;
        master.connect(comp).connect(ctx.destination);
        this.master = master;
        this.dry = ctx.createGain();
        this.dry.connect(master);
        const reverb = ctx.createConvolver();
        reverb.buffer = this.makeStadiumImpulse(ctx);
        this.wet = ctx.createGain();
        this.wet.gain.value = 0.22;
        this.wet.connect(reverb).connect(master);
        this.noise = this.makeNoise(ctx);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = undefined;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // Storage unavailable (private mode): the setting just won't persist.
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  /** Bat on ball. */
  bat(hit: BatHit): void {
    const ctx = this.ready();
    if (!ctx) return;
    const samples = renderBatHit(hit, ctx.sampleRate, (this.hits += 7919));
    const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buf.getChannelData(0).set(samples);
    this.play(buf, 1, 1);
  }

  bounce(onPitch: boolean, impact: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const loud = Math.min(0.4, 0.06 + impact / 30);
    // A hard ball on a hard, dry pitch: a dull thud; on the outfield, softer.
    this.ping(onPitch ? 190 : 120, 0.035, loud, t);
    this.burst(onPitch ? 1200 : 600, 1.2, 0.02, loud * 0.7, t);
  }

  pad(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    // Leather on the padded front of the leg guard: a muffled thump.
    this.ping(105, 0.07, 0.5, t);
    this.ping(240, 0.04, 0.25, t);
    this.burst(600, 0.9, 0.045, 0.35, t);
  }

  stumps(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    // Ash stumps knocked back, then the bails clattering.
    this.ping(820, 0.09, 0.45, t);
    this.ping(1330, 0.07, 0.35, t + 0.004);
    this.burst(2500, 1.5, 0.03, 0.4, t);
    for (let i = 0; i < 4; i++) this.ping(2100 + i * 410, 0.025, 0.14, t + 0.08 + i * 0.06);
    this.cheer(0.85, 3);
  }

  catchTaken(): void {
    const ctx = this.ready();
    if (!ctx) return;
    // Ball into hands.
    this.ping(260, 0.03, 0.4, ctx.currentTime);
    this.burst(1100, 0.9, 0.03, 0.4, ctx.currentTime);
    this.cheer(0.9, 3.5);
  }

  boundary(six: boolean): void {
    this.cheer(six ? 1 : 0.75, six ? 4.5 : 3.5);
  }

  /** The crowd reacts: a roar of voices and applause that rises and dies away. */
  cheer(intensity: number, seconds: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const buf = this.renderCrowd(ctx, intensity, seconds);
    this.play(buf, 0.85, 1.4);
  }

  private ready(): AudioContext | undefined {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return undefined;
    return ctx;
  }

  private play(buf: AudioBuffer, level: number, wetLevel: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.dry || !this.wet) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = level;
    src.connect(g);
    g.connect(this.dry);
    if (wetLevel > 0) {
      const send = ctx.createGain();
      send.gain.value = wetLevel;
      g.connect(send).connect(this.wet);
    }
    src.start();
  }

  /**
   * An open stadium: no enclosed-room reverb, but a slap back off the
   * stands (≈70–180 ms) and a short diffuse tail, darker as it decays.
   */
  private makeStadiumImpulse(ctx: AudioContext): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.ceil(sr * 1.4);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      const rnd = new Noise(97 + ch * 31);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = t < 0.06 ? 0 : Math.exp(-(t - 0.06) / 0.28);
        // Darken over time with a one-pole low-pass whose cutoff falls.
        const k = 0.5 * Math.exp(-t * 2.5) + 0.05;
        lp += k * (rnd.next() - lp);
        data[i] = lp * env * 0.6;
      }
      // Discrete reflections off the stands, different each side.
      const taps = ch === 0 ? [0.072, 0.118, 0.171] : [0.083, 0.131, 0.188];
      taps.forEach((tap, k) => {
        const i = Math.floor(tap * sr);
        data[i] = (data[i] ?? 0) + 0.5 / (k + 1);
      });
    }
    return buf;
  }

  /**
   * Crowd reaction: many voices (noise through vowel formants with their own
   * swells) plus applause (a dense scatter of short clap transients).
   */
  private renderCrowd(ctx: AudioContext, intensity: number, seconds: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.ceil(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    const rnd = new Noise(0x9e3779b1 ^ Math.floor(seconds * 1000 + intensity * 7));
    // Overall shape: quick rise, sustain, long fall.
    const shape = (t: number) => Math.min(1, t / 0.35) * Math.exp(-Math.max(0, t - 0.6) / (seconds / 3));
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      // Voices: band-limited noise around two formants ("aah" ≈ 700 Hz, 1200 Hz), each with a slow tremble.
      const voices = 6;
      for (let v = 0; v < voices; v++) {
        const f1 = 520 + rnd.unit() * 380;
        const f2 = f1 * (1.6 + rnd.unit() * 0.5);
        const rate = 2 + rnd.unit() * 4;
        const start = rnd.unit() * 0.25;
        // Two-pole resonators.
        const r = 0.985;
        const c1 = 2 * r * Math.cos((2 * Math.PI * f1) / sr);
        const c2 = 2 * r * Math.cos((2 * Math.PI * f2) / sr);
        let y1 = 0, y1b = 0, y2 = 0, y2b = 0;
        for (let i = 0; i < len; i++) {
          const t = i / sr - start;
          if (t < 0) continue;
          const x = rnd.next();
          const a = c1 * y1 - r * r * y1b + x;
          y1b = y1;
          y1 = a;
          const b = c2 * y2 - r * r * y2b + x;
          y2b = y2;
          y2 = b;
          const tremble = 0.75 + 0.25 * Math.sin(2 * Math.PI * rate * t + v);
          data[i] = (data[i] ?? 0) + (a * 0.6 + b * 0.4) * 0.006 * tremble * shape(t) * intensity;
        }
      }
      // Applause: claps arrive at a rate that follows the shape.
      const clapsPerSecond = 90 * intensity;
      let t = 0.15 + rnd.unit() * 0.1;
      while (t < seconds) {
        const i0 = Math.floor(t * sr);
        const level = (0.12 + rnd.unit() * 0.12) * shape(t) * intensity;
        const bright = 0.4 + rnd.unit() * 0.5;
        let lp = 0;
        const n = Math.floor(sr * 0.012);
        for (let i = 0; i < n && i0 + i < len; i++) {
          lp += bright * (rnd.next() - lp);
          const idx = i0 + i;
          data[idx] = (data[idx] ?? 0) + (rnd.next() - lp) * level * Math.exp(-i / (sr * 0.0025));
        }
        t += -Math.log(1 - rnd.unit() * 0.999) / Math.max(1, clapsPerSecond * Math.max(0.05, shape(t)));
      }
    }
    return buf;
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    const rnd = new Noise(1234567);
    for (let i = 0; i < data.length; i++) data[i] = rnd.next();
    return buf;
  }

  private ping(freq: number, decay: number, level: number, at: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.dry || !this.wet) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.9, at + decay);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay * 2.5);
    osc.connect(gain);
    gain.connect(this.dry);
    gain.connect(this.wet);
    osc.start(at);
    osc.stop(at + decay * 2.6);
  }

  private burst(freq: number, q: number, length: number, level: number, at: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.dry || !this.wet || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    src.connect(filter).connect(gain);
    gain.connect(this.dry);
    gain.connect(this.wet);
    src.start(at, Math.abs(Math.sin(at * 7919)) % 1.5);
    src.stop(at + length + 0.02);
  }
}

export const sound = new SoundEngine();
