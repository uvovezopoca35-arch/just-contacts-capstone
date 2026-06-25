/**
 * Tiny synthesized sound effects via the Web Audio API — no audio assets.
 * Reads its on/off + volume from localStorage so it works from anywhere
 * (UI reactivity is mirrored by the settings provider).
 */

const KEY_ENABLED = 'jc_sound_enabled';
const KEY_VOLUME = 'jc_sound_volume';

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    try { ctx = new AC(); } catch { return null; }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function soundEnabled(): boolean {
  try { return localStorage.getItem(KEY_ENABLED) !== '0'; } catch { return true; }
}

export function soundVolume(): number {
  try {
    const v = parseFloat(localStorage.getItem(KEY_VOLUME) || '0.5');
    return isNaN(v) ? 0.5 : Math.min(1, Math.max(0, v));
  } catch { return 0.5; }
}

type Note = { f: number; t: number; d: number };

function playNotes(notes: Note[], type: OscillatorType, gainScale = 1) {
  const c = getCtx();
  if (!c) return;
  // Master cap keeps it gentle even at full volume
  const vol = soundVolume() * 0.16 * gainScale;
  if (vol <= 0) return;
  const now = c.currentTime;
  for (const n of notes) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = n.f;
    const start = now + n.t;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
    o.connect(g).connect(c.destination);
    o.start(start);
    o.stop(start + n.d + 0.03);
  }
}

export type SoundKind = 'success' | 'error' | 'click' | 'delete';

/** Play a short UI sound (no-op when sound is disabled). */
export function playSound(kind: SoundKind) {
  if (!soundEnabled()) return;
  switch (kind) {
    case 'success':
      playNotes([{ f: 660, t: 0, d: 0.12 }, { f: 880, t: 0.09, d: 0.16 }], 'sine');
      break;
    case 'error':
      playNotes([{ f: 240, t: 0, d: 0.16 }, { f: 180, t: 0.12, d: 0.2 }], 'square', 0.8);
      break;
    case 'delete':
      playNotes([{ f: 360, t: 0, d: 0.1 }, { f: 200, t: 0.08, d: 0.16 }], 'triangle');
      break;
    case 'click':
      playNotes([{ f: 520, t: 0, d: 0.05 }], 'sine', 0.9);
      break;
  }
}

/** Resume/create the AudioContext on a user gesture (iOS requires this). */
export function unlockAudio() {
  getCtx();
}
