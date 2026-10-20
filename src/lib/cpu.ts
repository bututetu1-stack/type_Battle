// ソロ（バトル）の敵CPUの動き。SoloGame と scripts/balance-sim.ts（模擬対戦）が同じ関数を使う。
//
// CPU は「打つ速さ」を持ったプレイヤーとして動く。プレイヤーと同じペースで単語が積まれ
// （供給は時間とともに速くなる）、自分の速さで片付ける。供給が速さを上回ると山が育ち、
// 上限を超えたら脱落する。だから遅いCPUから順に脱落し、最後は「誰がいちばん長く耐えるか」と
// 「攻撃でとどめを刺せるか」の勝負になる（テトリス99と同じ構図）。
// 以前は強さに応じて上下するだけの乱数で、強いCPUは時間が経っても弱らず、
// 速い人でも最後まで勝ち残れなかった。
import type { Dummy } from './types';

export const CPU_KEYS_PER_WORD = 9.2; // 出題1語あたりの平均打鍵数（全テーマで実測）
export const CPU_READ_MS = 300; // お題を読んで打ち始めるまで
export const CPU_ATTACK_EVERY = 5; // 何語クリアごとに攻撃するか（プレイヤーの既定と同じ）

// 強さ str（0..1）→ 打鍵の速さ（KPS）。0 で 1.0、0.5 で 4.5、1 で 8.0。
export const cpuKps = (str: number): number => 1 + 7 * str;
// 1秒あたりに片付けられる語数。
export const cpuWordsPerSec = (str: number): number => 1 / (CPU_READ_MS / 1000 + CPU_KEYS_PER_WORD / cpuKps(str));
// 1語の間にミスする確率（連鎖の切れやすさ）。速いCPUほど正確。
const cpuMissPerWord = (str: number): number => 0.45 - 0.3 * str;

// 新しい試合のCPUを作る。強さは平均 avgStr の周りに ±spread でばらつかせる。
export function makeCpu(id: number, name: string, avgStr: number, rnd: () => number, spread = 0.25): Dummy {
  const str = Math.min(1, Math.max(0, avgStr + (rnd() * 2 - 1) * spread));
  return { id, name, height: 2 + Math.floor(rnd() * 3), isKO: false, combo: 0, atk: 0, str, feed: rnd(), prog: rnd() * 0.5, gauge: 0 };
}

// 攻撃の出し方。ソロは既定値、オンラインは部屋の設定（何語で攻撃・何連鎖で+1）を渡す。
export interface CpuAttackOpts {
  attackEvery?: number; // 何語クリアごとに攻撃するか
  comboStep?: number; // 何連鎖ごとに攻撃量が+1されるか
  attackCap?: number; // 1回の攻撃量の上限（CPU は人より控えめに 3 まで）
}

export interface CpuStep {
  next: Dummy;
  attacks: number[]; // この1秒で放った攻撃（おじゃまの数）
  overflow: boolean; // この1秒で上限を超えて脱落した
}

// 1秒ぶん進める。supplyPerSec = いまの供給ペース（1秒あたりの語数＝プレイヤーと同じ）。
export function stepCpu(d: Dummy, supplyPerSec: number, maxH: number, rnd: () => number, opts: CpuAttackOpts = {}): CpuStep {
  const { attackEvery = CPU_ATTACK_EVERY, comboStep = 5, attackCap = 3 } = opts;
  if (d.isKO) return { next: d, attacks: [], overflow: false };
  const str = d.str ?? 0.5;
  let height = d.height;
  let feed = (d.feed ?? 0) + supplyPerSec;
  let prog = (d.prog ?? 0) + cpuWordsPerSec(str) * (0.6 + 0.8 * rnd()); // 調子のむら
  let gauge = d.gauge ?? 0;
  let combo = d.combo ?? 0;
  const attacks: number[] = [];
  while (feed >= 1) { height++; feed--; }
  while (prog >= 1 && height > 0) {
    height--; prog--;
    combo = rnd() < cpuMissPerWord(str) ? 0 : combo + 1;
    if (++gauge >= attackEvery) { gauge = 0; attacks.push(Math.min(1 + Math.floor(combo / comboStep), attackCap)); }
  }
  if (height === 0) prog = Math.min(prog, 0.5); // 山が空の間は先に進めない（手が空く）
  if (height > maxH) return { next: { ...d, height: 0, isKO: true, combo: 0, feed, prog, gauge }, attacks, overflow: true };
  return { next: { ...d, height, combo, feed, prog, gauge }, attacks, overflow: false };
}

// CPU の攻撃の行き先を決める。自分（プレイヤー）は CPU 1体の playerWeight 倍狙われやすい
// （バトルロワイヤルの主役として集中砲火を受ける）。均等に選ぶと自分への攻撃が以前の約4分の1になり、
// 着弾予告・相殺・防御アイテムの出番がほとんど無くなったため。
// 戻り値は 'player' か、相手の CPU の添字（others の中の位置）。
export const CPU_PLAYER_WEIGHT = 3;
export function pickCpuTarget(othersCount: number, rnd: () => number, playerWeight = CPU_PLAYER_WEIGHT): number | 'player' {
  const r = rnd() * (othersCount + playerWeight);
  return r >= othersCount ? 'player' : Math.floor(r);
}

// stepCpu の結果（before→after の変化）を最新の状態 latest に重ねる。
// 画面では step を計算している間にプレイヤーの攻撃が入ることがあり、after で丸ごと
// 置き換えるとその攻撃が消えてしまうため、高さは差分だけを足す。
export function mergeCpuStep(latest: Dummy, before: Dummy, after: Dummy, maxH: number): Dummy {
  if (latest.isKO) return latest;
  const { combo, feed, prog, gauge } = after;
  const height = after.isKO ? maxH + 1 : latest.height + (after.height - before.height);
  if (height > maxH) return { ...latest, height: 0, isKO: true, combo: 0, feed, prog, gauge };
  return { ...latest, height: Math.max(0, height), combo, feed, prog, gauge };
}
