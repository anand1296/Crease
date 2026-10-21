/**
 * Procedural sound effects with the Web Audio API: no audio files, so
 * nothing can fail to load and there is nothing to license. Audio starts on
 * the first user gesture (browser autoplay rules) and can be muted; if Web
 * Audio is unavailable every call is a silent no-op.
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

class SoundEngine {
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private crowdGain: GainNode | undefined;
  private crowdFilter: BiquadFilterNode | undefined;
  private noise: AudioBuffer | undefined;
  muted = readMuted();

  /** Call from a user gesture; safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = audioCtor();
        if (!Ctor) return;
        const ctx = new Ctor();
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.8;
        this.master.connect(ctx.destination);
        this.noise = this.makeNoise(ctx);
        this.startCrowd(ctx);
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
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Bat on ball. `quality` 0–1, `speed` exit speed m/s, `edge` for a thin nick. */
  bat(quality: number, speed: number, edge: boolean): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const loud = Math.min(1, 0.35 + speed / 45);
    if (edge) {
      this.ping(3100, 0.05, 0.25 * loud, t);
      this.burst(4000, 6, 0.02, 0.25 * loud, t);
      return;
    }
    // Crack of the blade plus woody resonances: a clean strike rings longer and brighter.
    const ring = 0.06 + 0.12 * quality;
    this.burst(2400, 1.2, 0.018, 0.55 * loud, t);
    this.ping(820 + 180 * quality, ring, 0.5 * loud, t);
    this.ping(1480 + 200 * quality, ring * 0.8, 0.3 * loud * (0.4 + quality), t);
    this.ping(2350, ring * 0.5, 0.18 * loud * quality, t);
  }

  bounce(onPitch: boolean, impact: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const loud = Math.min(0.5, 0.08 + impact / 25);
    this.ping(onPitch ? 210 : 150, 0.06, loud, t);
    this.burst(onPitch ? 900 : 500, 1, 0.03, loud * 0.6, t);
  }

  pad(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.ping(125, 0.09, 0.45, t);
    this.burst(700, 0.8, 0.05, 0.35, t);
  }

  stumps(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.ping(1150, 0.12, 0.4, t);
    this.ping(1720, 0.1, 0.3, t + 0.012);
    // Bails clattering.
    for (let i = 0; i < 4; i++) this.ping(2400 + i * 330, 0.04, 0.12, t + 0.05 + i * 0.045);
    this.cheer(0.8, 3);
  }

  catchTaken(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.burst(1300, 0.9, 0.035, 0.45, ctx.currentTime);
    this.cheer(0.9, 3.5);
  }

  boundary(six: boolean): void {
    this.cheer(six ? 1 : 0.75, six ? 4 : 3);
  }

  /** The crowd rises and settles. */
  cheer(intensity: number, seconds: number): void {
    const ctx = this.ready();
    if (!ctx || !this.crowdGain || !this.crowdFilter) return;
    const t = ctx.currentTime;
    const g = this.crowdGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.06 + 0.32 * intensity, t + 0.35);
    g.setTargetAtTime(0.06, t + 0.6, seconds / 3);
    const f = this.crowdFilter.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    f.linearRampToValueAtTime(900 + 900 * intensity, t + 0.35);
    f.setTargetAtTime(700, t + 0.6, seconds / 3);
  }

  private ready(): AudioContext | undefined {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return undefined;
    return ctx;
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Deterministic noise (no Math.random in the project).
    let seed = 1234567;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    return buf;
  }

  private startCrowd(ctx: AudioContext): void {
    if (!this.noise || !this.master) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 700;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0.06;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.crowdGain = gain;
    this.crowdFilter = filter;
  }

  private ping(freq: number, decay: number, level: number, at: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.85, at + decay);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay * 2.5);
    osc.connect(gain).connect(this.master);
    osc.start(at);
    osc.stop(at + decay * 2.6);
  }

  private burst(freq: number, q: number, length: number, level: number, at: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(at, Math.abs(Math.sin(at * 7919)) % 1.5);
    src.stop(at + length + 0.02);
  }
}

export const sound = new SoundEngine();
