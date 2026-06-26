// Web Audio による軽量な効果音。音声ファイル不要（オシレーターで生成）。
// ブラウザの自動再生制限のため、初回ユーザー操作で resumeAudio() を呼ぶ。

let ctx: AudioContext | null = null;
let enabled = true;

function ac(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  return ctx;
}

export function setSfxEnabled(v: boolean): void {
  enabled = v;
}
export function isSfxEnabled(): boolean {
  return enabled;
}

// 初回キー入力などで呼び、AudioContext を起動/再開する。
export function resumeAudio(): void {
  try {
    ac().resume();
  } catch {
    /* noop */
  }
}

function blip(freq: number, dur: number, type: OscillatorType = 'square', gain = 0.05, delay = 0): void {
  if (!enabled) return;
  try {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    const t = c.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + dur);
  } catch {
    /* noop */
  }
}

export const sfx = {
  type: () => blip(880, 0.035, 'square', 0.02),
  clear: () => {
    blip(660, 0.08, 'triangle', 0.05);
    blip(990, 0.1, 'triangle', 0.05, 0.06);
  },
  miss: () => blip(150, 0.12, 'sawtooth', 0.05),
  attack: () => {
    blip(520, 0.07, 'square', 0.06);
    blip(380, 0.1, 'square', 0.06, 0.04);
    blip(280, 0.12, 'square', 0.05, 0.08);
  },
  item: () => {
    blip(784, 0.08, 'triangle', 0.06);
    blip(1046, 0.12, 'triangle', 0.06, 0.07);
  },
  use: () => {
    blip(660, 0.06, 'square', 0.05);
    blip(880, 0.09, 'square', 0.05, 0.05);
  },
  ko: () => {
    blip(300, 0.18, 'sawtooth', 0.07);
    blip(150, 0.22, 'sawtooth', 0.07, 0.1);
  },
  eliminate: () => {
    blip(330, 0.1, 'triangle', 0.05);
    blip(196, 0.16, 'triangle', 0.05, 0.07);
  },
  // 受け流し成功: 金属的でキラッとした上昇音。
  parry: () => {
    blip(1200, 0.06, 'square', 0.05);
    blip(1600, 0.06, 'sine', 0.05, 0.04);
    blip(2100, 0.12, 'triangle', 0.05, 0.08);
  },
  countdown: () => blip(600, 0.08, 'sine', 0.05),
  start: () => {
    blip(523, 0.1, 'sine', 0.06);
    blip(784, 0.16, 'sine', 0.06, 0.1);
  },
  gameover: () => {
    blip(392, 0.18, 'sawtooth', 0.06);
    blip(261, 0.28, 'sawtooth', 0.06, 0.14);
  },
};
