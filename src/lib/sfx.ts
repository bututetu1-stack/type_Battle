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

// 周波数をスイープする単音（上昇/下降）。ビーム/警告/コンボの演出に。
function sweep(f0: number, f1: number, dur: number, type: OscillatorType = 'sawtooth', gain = 0.05, delay = 0): void {
  if (!enabled) return;
  try {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    const t = c.currentTime + delay;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
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

// ホワイトノイズのバースト（爆発・撃破・衝撃の芯）。lowpass で質感を変える。
function noise(dur: number, gain = 0.08, delay = 0, cutoff = 1800): void {
  if (!enabled) return;
  try {
    const c = ac();
    const frames = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, frames, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = c.createBufferSource();
    src.buffer = buf;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    const g = c.createGain();
    const t = c.currentTime + delay;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp);
    lp.connect(g);
    g.connect(c.destination);
    src.start(t);
    src.stop(t + dur);
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
  // 攻撃を放つ: 発射のスイープ＋衝撃ノイズで“ドンッ”と。
  attack: () => {
    sweep(720, 260, 0.14, 'sawtooth', 0.06);
    blip(380, 0.1, 'square', 0.05, 0.03);
    noise(0.08, 0.05, 0.02, 2600);
  },
  item: () => {
    blip(784, 0.08, 'triangle', 0.06);
    blip(1046, 0.12, 'triangle', 0.06, 0.07);
  },
  use: () => {
    blip(660, 0.06, 'square', 0.05);
    blip(880, 0.09, 'square', 0.05, 0.05);
  },
  // アイテム発動: カテゴリ別のSE（攻=下降パワー / 防=上昇シールド / 効=きらめき）。
  itemAtk: () => {
    sweep(600, 200, 0.16, 'sawtooth', 0.06);
    noise(0.1, 0.06, 0.03, 2200);
  },
  itemDef: () => {
    sweep(400, 900, 0.16, 'sine', 0.06);
    blip(1200, 0.1, 'triangle', 0.05, 0.08);
  },
  itemTimed: () => {
    blip(880, 0.07, 'triangle', 0.05);
    blip(1320, 0.09, 'sine', 0.05, 0.06);
    blip(1760, 0.12, 'sine', 0.05, 0.12);
  },
  // 撃破/KO: 低いブーム＋ノイズの爆発感。
  ko: () => {
    noise(0.22, 0.1, 0, 1400);
    sweep(420, 90, 0.3, 'sawtooth', 0.08, 0.02);
  },
  // 相手を撃破した瞬間の爆発（自分のキル）。
  explode: () => {
    noise(0.28, 0.12, 0, 1200);
    blip(120, 0.24, 'sawtooth', 0.08, 0.02);
    blip(70, 0.3, 'sine', 0.06, 0.05);
  },
  // 被弾（攻撃を受けた）: 鈍い下降音＋衝撃ノイズ。
  damage: () => {
    noise(0.1, 0.06, 0, 900);
    blip(200, 0.12, 'square', 0.07, 0.01);
    blip(120, 0.18, 'sawtooth', 0.06, 0.06);
  },
  eliminate: () => {
    blip(330, 0.1, 'triangle', 0.05);
    blip(196, 0.16, 'triangle', 0.05, 0.07);
  },
  // 連鎖マイルストーン到達: 段階で高くなる上昇アルペジオ（step で音程UP）。
  combo: (step = 0) => {
    const base = 660 + Math.min(step, 6) * 90;
    blip(base, 0.06, 'triangle', 0.05);
    blip(base * 1.25, 0.08, 'triangle', 0.05, 0.05);
    blip(base * 1.5, 0.1, 'sine', 0.05, 0.1);
  },
  // お宝取得: キラッとした短い上昇。
  treasure: () => {
    blip(1046, 0.05, 'sine', 0.05);
    blip(1568, 0.08, 'sine', 0.05, 0.04);
    blip(2093, 0.1, 'triangle', 0.04, 0.08);
  },
  // ピンチ警告: 不穏な2連パルス。
  warn: () => {
    blip(300, 0.09, 'square', 0.05);
    blip(300, 0.09, 'square', 0.05, 0.14);
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
