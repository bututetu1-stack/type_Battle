import { describe, expect, it } from 'vitest';
import { DIFFICULTY_PRESETS, DIFFICULTY_KEYS, accelFromSpeed, speedFromAccel, migrateDifficulty } from './difficulty';
import { makeCpu, stepCpu, mergeCpuStep, cpuWordsPerSec } from './cpu';
import { mulberry32 } from './rng';

describe('難易度プリセット', () => {
  it('設定画面のスライダーで表せる値になっている（そうでないと選んだ直後に「カスタム」表示になる）', () => {
    for (const k of DIFFICULTY_KEYS) {
      const p = DIFFICULTY_PRESETS[k];
      expect(p.initial % 100).toBe(0);
      expect(p.initial).toBeGreaterThanOrEqual(500);
      expect(p.initial).toBeLessThanOrEqual(6000);
      expect(p.min % 100).toBe(0);
      expect(p.min).toBeGreaterThanOrEqual(300);
      expect(p.min).toBeLessThanOrEqual(3000);
      expect((p.accelSpeed * 2) % 1).toBe(0);
      expect(p.hp).toBeGreaterThanOrEqual(6);
      expect(p.hp).toBeLessThanOrEqual(24);
      expect(p.enemies).toBeGreaterThanOrEqual(1);
      expect(p.enemies).toBeLessThanOrEqual(30);
      expect(Number.isInteger(p.cpuStr)).toBe(true);
      expect(speedFromAccel(accelFromSpeed(p.accelSpeed))).toBeCloseTo(p.accelSpeed);
    }
  });

  it('かんたん → ふつう → むずかしい の順に厳しくなる', () => {
    const [e, n, h] = DIFFICULTY_KEYS.map((k) => DIFFICULTY_PRESETS[k]);
    expect(e.initial).toBeGreaterThan(n.initial);
    expect(n.initial).toBeGreaterThan(h.initial);
    expect(e.cpuStr).toBeLessThan(n.cpuStr);
    expect(n.cpuStr).toBeLessThan(h.cpuStr);
  });

  it('旧プリセットのままの保存設定は、同じ名前の新しいプリセットへ移る', () => {
    const old = { initial: 2800, min: 1100, accel: 0.98, hp: 12, enemies: 10, cpuStr: 5, theme: 'food', soloMode: 'royale' };
    const m = migrateDifficulty(old);
    const p = DIFFICULTY_PRESETS.normal;
    expect(m).toMatchObject({ initial: p.initial, min: p.min, accel: accelFromSpeed(p.accelSpeed), hp: p.hp, enemies: p.enemies, cpuStr: p.cpuStr });
    expect(m.theme).toBe('food'); // 難易度以外はそのまま
  });

  it('以前の初期設定（カスタム扱いだった）は「ふつう」へ移る', () => {
    const m = migrateDifficulty({ initial: 4000, min: 1000, accel: 0.98, hp: 12, enemies: 20, cpuStr: 5 });
    expect(m.enemies).toBe(DIFFICULTY_PRESETS.normal.enemies);
  });

  it('自分で調整した値は変えない', () => {
    const mine = { initial: 2800, min: 1100, accel: 0.98, hp: 12, enemies: 11, cpuStr: 5 };
    expect(migrateDifficulty(mine)).toBe(mine);
    expect(migrateDifficulty(null)).toBe(null);
  });
});

describe('CPU の動き', () => {
  // 一定の供給ペースで何秒もつか（脱落しなければ上限秒数）。
  const survive = (str: number, supply: number, seed: number) => {
    const R = mulberry32(seed);
    let d = { ...makeCpu(0, 'x', str, R, 0), height: 3 };
    for (let t = 1; t <= 300; t++) {
      d = stepCpu(d, supply, 12, R).next;
      if (d.isKO) return t;
    }
    return 300;
  };

  it('速いCPUほど1秒あたりに多く片付ける', () => {
    expect(cpuWordsPerSec(0.8)).toBeGreaterThan(cpuWordsPerSec(0.5));
    expect(cpuWordsPerSec(0.5)).toBeGreaterThan(cpuWordsPerSec(0.2));
  });

  it('供給が速さを上回ると山が育って脱落し、下回っていれば耐える', () => {
    const fast = cpuWordsPerSec(0.6);
    expect(survive(0.6, fast * 1.5, 1)).toBeLessThan(120);
    expect(survive(0.6, fast * 0.6, 1)).toBe(300);
  });

  it('同じ供給なら速いCPUの方が長く耐える', () => {
    const supply = cpuWordsPerSec(0.5) * 1.2;
    let slow = 0, fast = 0;
    for (let s = 0; s < 20; s++) { slow += survive(0.3, supply, s); fast += survive(0.7, supply, s); }
    expect(fast).toBeGreaterThan(slow);
  });

  it('1秒の変化を重ねる時、同時に入ったプレイヤーの攻撃を消さない', () => {
    const R = mulberry32(7);
    const before = { ...makeCpu(0, 'x', 0.5, R), height: 4 };
    const after = stepCpu(before, 0.5, 12, R).next;
    const latest = { ...before, height: before.height + 3 }; // 計算中に +3 の攻撃が入った
    const merged = mergeCpuStep(latest, before, after, 12);
    expect(merged.height).toBe(after.height + 3);
    // 合わせて上限を超えたら脱落
    expect(mergeCpuStep({ ...before, height: 12 }, before, { ...after, height: before.height + 1 }, 12).isKO).toBe(true);
  });
});
