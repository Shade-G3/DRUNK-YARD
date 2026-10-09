/** Tiny synthesized sounds (no audio files to download) + haptics. */
let ctx: AudioContext | null = null;
let enabled = true;

export function setSound(on: boolean) {
  enabled = on;
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function ping(freq: number, at: number, dur = 0.5, gain = 0.15) {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + at);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + at);
  o.stop(c.currentTime + at + dur + 0.05);
}

export function clink() {
  ping(2637, 0, 0.6, 0.12);
  ping(3520, 0.01, 0.45, 0.07);
  ping(2793, 0.09, 0.5, 0.06);
  buzz(15);
}

export function pour(seconds = 1.2) {
  const c = ac();
  if (!c) return;
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(i / 900));
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.setValueAtTime(700, c.currentTime);
  f.frequency.linearRampToValueAtTime(1400, c.currentTime + seconds);
  f.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.linearRampToValueAtTime(0.18, c.currentTime + 0.1);
  g.gain.linearRampToValueAtTime(0.0001, c.currentTime + seconds);
  src.connect(f).connect(g).connect(c.destination);
  src.start();
}

export function fanfare() {
  [523, 659, 784, 1047].forEach((f, i) => ping(f, i * 0.12, 0.7, 0.1));
  buzz([30, 60, 30, 60, 80]);
}

export function blip() {
  ping(880, 0, 0.15, 0.06);
}

export function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}
