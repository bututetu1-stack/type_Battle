// Web Audio による効果音（音源不要のミニ・シンセ）。
// マスターにコンプ/リミッタとリバーブ送りを通し、アーケード風の“作り込んだ”質感にする。
// ブラウザの自動再生制限のため、初回ユーザー操作で resumeAudio() を呼ぶ。

let ctx: AudioContext | null = null;
let enabled = true;
let master: GainNode | null = null; // 全音の集約（音量）
let reverb: GainNode | null = null; // リバーブ送り（ここに繋ぐと残響が付く）

// 減衰ノイズのインパルス応答（簡易リバーブ用）。
function makeImpulse(c: AudioContext, dur: number, decay: number): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function ac(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  const c = ctx;
  if (!master) {
    master = c.createGain();
    master.gain.value = 0.85;
    // リミッタ代わりのコンプレッサ（クリップ防止＋グルー）。
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 22;
    comp.ratio.value = 12;
    comp.attack.value = 0.003;
    comp.release.value = 0.16;
    master.connect(comp);
    comp.connect(c.destination);
    // リバーブ送り。
    try {
      const conv = c.createConvolver();
      conv.buffer = makeImpulse(c, 1.0, 2.6);
      reverb = c.createGain();
      reverb.gain.value = 1;
      reverb.connect(conv);
      conv.connect(master);
    } catch {
      reverb = null;
    }
  }
  return c;
}

export function setSfxEnabled(v: boolean): void {
  enabled = v;
}
export function isSfxEnabled(): boolean {
  return enabled;
}
export function setVolume(v: number): void {
  try {
    ac();
    if (master) master.gain.value = Math.max(0, Math.min(1, v));
  } catch {
    /* noop */
  }
}

// 初回キー入力などで呼び、AudioContext を起動/再開する。
export function resumeAudio(): void {
  try {
    ac().resume();
  } catch {
    /* noop */
  }
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  slideTo?: number; // ピッチスライド先
  detune?: number; // 2本目のデチューン（厚み）
  cutoff?: number; // ローパス開始
  cutoffTo?: number; // ローパス掃引先
  reverb?: number; // リバーブ送り量（0..1）
}

// 単音（＋任意でデチューン重ね・フィルタ掃引・リバーブ送り）。
function tone(freq: number, dur: number, delay = 0, o: ToneOpts = {}): void {
  if (!enabled) return;
  try {
    const c = ac();
    const t = c.currentTime + delay;
    const g = c.createGain();
    const peak = o.gain ?? 0.05;
    const atk = Math.min(o.attack ?? 0.005, dur / 2);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out: AudioNode = g;
    if (o.cutoff) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(o.cutoff, t);
      if (o.cutoffTo) lp.frequency.exponentialRampToValueAtTime(Math.max(1, o.cutoffTo), t + dur);
      g.connect(lp);
      out = lp;
    }
    out.connect(master as GainNode);
    if (o.reverb && reverb) {
      const rs = c.createGain();
      rs.gain.value = o.reverb;
      out.connect(rs);
      rs.connect(reverb);
    }
    const mk = (detune: number) => {
      const osc = c.createOscillator();
      osc.type = o.type ?? 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), t + dur);
      if (detune) osc.detune.value = detune;
      osc.connect(g);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    };
    mk(0);
    if (o.detune) mk(o.detune);
  } catch {
    /* noop */
  }
}

// フィルタ掃引ノイズ（衝撃・爆発の芯）。
function noiseHit(dur: number, delay = 0, o: { gain?: number; cutoff?: number; cutoffTo?: number; reverb?: number } = {}): void {
  if (!enabled) return;
  try {
    const c = ac();
    const t = c.currentTime + delay;
    const frames = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, frames, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = c.createBufferSource();
    src.buffer = buf;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(o.cutoff ?? 2000, t);
    if (o.cutoffTo) lp.frequency.exponentialRampToValueAtTime(Math.max(1, o.cutoffTo), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(o.gain ?? 0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp);
    lp.connect(g);
    g.connect(master as GainNode);
    if (o.reverb && reverb) {
      const rs = c.createGain();
      rs.gain.value = o.reverb;
      g.connect(rs);
      rs.connect(reverb);
    }
    src.start(t);
    src.stop(t + dur);
  } catch {
    /* noop */
  }
}

export const sfx = {
  // 打鍵: 超短いクリック（毎回わずかにピッチを散らして単調にしない）。
  type: () => tone(720 + Math.random() * 160, 0.028, 0, { type: 'square', gain: 0.016, cutoff: 3200 }),
  // クリア: 明るい2音ピン＋軽リバーブ。
  clear: () => {
    tone(784, 0.09, 0, { type: 'triangle', gain: 0.05, reverb: 0.12 });
    tone(1175, 0.12, 0.05, { type: 'triangle', gain: 0.045, reverb: 0.14 });
  },
  miss: () => tone(180, 0.12, 0, { type: 'sawtooth', gain: 0.05, slideTo: 90, cutoff: 1400 }),
  // 攻撃: 発射スイープ→着弾ノイズ→サブの“ドスッ”。
  attack: () => {
    tone(720, 0.14, 0, { type: 'sawtooth', gain: 0.05, slideTo: 200, cutoff: 2600, cutoffTo: 500 });
    noiseHit(0.09, 0.04, { gain: 0.05, cutoff: 3200, cutoffTo: 800 });
    tone(150, 0.14, 0.05, { type: 'sine', gain: 0.06, slideTo: 60 });
  },
  item: () => {
    tone(784, 0.08, 0, { type: 'triangle', gain: 0.05 });
    tone(1046, 0.1, 0.06, { type: 'triangle', gain: 0.05, reverb: 0.1 });
  },
  use: () => {
    tone(660, 0.06, 0, { type: 'square', gain: 0.05 });
    tone(990, 0.08, 0.05, { type: 'square', gain: 0.05 });
  },
  // アイテム発動のカテゴリ別SE。
  itemAtk: () => {
    tone(560, 0.16, 0, { type: 'sawtooth', gain: 0.055, slideTo: 160, cutoff: 2200 });
    noiseHit(0.1, 0.03, { gain: 0.05, cutoff: 2400, cutoffTo: 700 });
  },
  itemDef: () => {
    tone(420, 0.16, 0, { type: 'sine', gain: 0.05, slideTo: 980 });
    tone(1320, 0.12, 0.08, { type: 'triangle', gain: 0.045, reverb: 0.16 });
  },
  itemTimed: () => {
    tone(880, 0.07, 0, { type: 'triangle', gain: 0.045 });
    tone(1320, 0.09, 0.06, { type: 'sine', gain: 0.045 });
    tone(1760, 0.12, 0.12, { type: 'sine', gain: 0.04, reverb: 0.16 });
  },
  // 撃破/KO: フィルタノイズ爆発＋サブブーム＋下降クラッシュ＋残響。
  ko: () => {
    noiseHit(0.26, 0, { gain: 0.11, cutoff: 1500, cutoffTo: 300, reverb: 0.25 });
    tone(220, 0.32, 0.02, { type: 'sawtooth', gain: 0.08, slideTo: 60, reverb: 0.2 });
    tone(70, 0.34, 0.03, { type: 'sine', gain: 0.07, slideTo: 40 });
  },
  // 自分が相手を撃破した瞬間の“大爆発”。
  explode: () => {
    noiseHit(0.3, 0, { gain: 0.13, cutoff: 1300, cutoffTo: 260, reverb: 0.3 });
    tone(140, 0.28, 0.02, { type: 'sawtooth', gain: 0.09, slideTo: 55, reverb: 0.22 });
    tone(64, 0.34, 0.04, { type: 'sine', gain: 0.08, slideTo: 38 });
    tone(880, 0.14, 0, { type: 'square', gain: 0.04, slideTo: 200 });
  },
  // 被弾: 鈍い衝撃＋濁った低音。
  damage: () => {
    noiseHit(0.11, 0, { gain: 0.06, cutoff: 900, cutoffTo: 300 });
    tone(200, 0.13, 0.01, { type: 'square', gain: 0.07, slideTo: 90 });
    tone(300, 0.1, 0, { type: 'sawtooth', gain: 0.03, detune: 30 });
  },
  eliminate: () => {
    tone(330, 0.1, 0, { type: 'triangle', gain: 0.05 });
    tone(196, 0.16, 0.07, { type: 'triangle', gain: 0.05 });
  },
  // 連鎖マイルストーン: tier で高く・豪華になる上昇アルペジオ。
  combo: (tier = 0) => {
    const t = Math.min(Math.max(tier, 0), 6);
    const base = 523 * Math.pow(2, (t * 2) / 12); // tier ごとに全音上げ
    tone(base, 0.06, 0, { type: 'triangle', gain: 0.05 });
    tone(base * 1.25, 0.07, 0.05, { type: 'triangle', gain: 0.05 });
    tone(base * 1.5, 0.09, 0.1, { type: 'sine', gain: 0.05, reverb: 0.12 });
    if (t >= 3) tone(base * 2, 0.12, 0.15, { type: 'sine', gain: 0.045, reverb: 0.18 });
  },
  // お宝取得: きらめく上昇ベル。
  treasure: () => {
    tone(1046, 0.05, 0, { type: 'sine', gain: 0.05 });
    tone(1568, 0.06, 0.05, { type: 'sine', gain: 0.05 });
    tone(2093, 0.1, 0.1, { type: 'triangle', gain: 0.045, reverb: 0.2 });
  },
  // ピンチ警告: 不穏な2連。
  warn: () => {
    tone(320, 0.1, 0, { type: 'square', gain: 0.05, slideTo: 260 });
    tone(320, 0.1, 0.16, { type: 'square', gain: 0.05, slideTo: 260 });
  },
  countdown: () => tone(620, 0.09, 0, { type: 'sine', gain: 0.05 }),
  start: () => {
    tone(523, 0.1, 0, { type: 'sine', gain: 0.06 });
    tone(784, 0.1, 0.09, { type: 'sine', gain: 0.06 });
    tone(1046, 0.16, 0.18, { type: 'triangle', gain: 0.06, reverb: 0.2 });
  },
  // 勝利ファンファーレ。
  win: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, i * 0.09, { type: 'triangle', gain: 0.06, reverb: 0.22 }));
  },
  gameover: () => {
    tone(392, 0.2, 0, { type: 'sawtooth', gain: 0.06, slideTo: 180 });
    tone(261, 0.3, 0.14, { type: 'sawtooth', gain: 0.06, slideTo: 120, reverb: 0.2 });
  },
  parry: () => {
    tone(1200, 0.06, 0, { type: 'square', gain: 0.05 });
    tone(1800, 0.06, 0.04, { type: 'sine', gain: 0.05 });
    tone(2400, 0.12, 0.08, { type: 'triangle', gain: 0.05, reverb: 0.2 });
  },
};
