import type { CommentaryLine } from '../ai/commentary.ts';

/**
 * The commentator's voice: the browser's built-in speech synthesis (Web
 * Speech API) — no audio files, no network, no API keys. Prefers a British,
 * Indian or Australian English voice; speaks faster and higher for big
 * moments. A new line interrupts the previous one (a fresh ball is more
 * important than finishing the last sentence). Silently does nothing where
 * speech synthesis is unavailable.
 */
const KEY = 'crease.commentary';

export function readCommentaryEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveCommentaryEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // Not persisted.
  }
}

function synth(): SpeechSynthesis | undefined {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : undefined;
}

let chosen: SpeechSynthesisVoice | null | undefined;

function voice(s: SpeechSynthesis): SpeechSynthesisVoice | null {
  if (chosen !== undefined && chosen !== null) return chosen;
  const voices = s.getVoices();
  if (voices.length === 0) return null;
  const prefer = ['en-GB', 'en-IN', 'en-AU', 'en-US'];
  for (const lang of prefer) {
    const v = voices.find((x) => x.lang === lang && /male|daniel|rishi|george|arthur|james/i.test(x.name)) ?? voices.find((x) => x.lang === lang);
    if (v) {
      chosen = v;
      return v;
    }
  }
  chosen = voices.find((x) => x.lang.startsWith('en')) ?? null;
  return chosen;
}

export function speak(line: CommentaryLine): void {
  const s = synth();
  if (!s) return;
  try {
    s.cancel();
    const u = new SpeechSynthesisUtterance(line.text);
    const v = voice(s);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    u.rate = line.excitement === 2 ? 1.12 : line.excitement === 1 ? 1.06 : 1.0;
    u.pitch = line.excitement === 2 ? 1.12 : 1.0;
    u.volume = 0.9;
    s.speak(u);
  } catch {
    // Speech is a nicety; never let it break the game.
  }
}

export function hush(): void {
  try {
    synth()?.cancel();
  } catch {
    // Ignore.
  }
}
