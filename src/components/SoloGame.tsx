import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Swords, Zap, Trophy, Shield, AlertTriangle, Sparkles, Wind, Pause, ArrowLeft,
  Volume2, VolumeX, Bomb, Crown, Target, Lock, Scissors, ArrowDownToLine, Settings,
} from 'lucide-react';
import { mulberry32, randomSeed, type RNG } from '../lib/rng';
import { generateWord, makeOjamaWord, makeOjamaWordFrom, makeShortWord, randomLongWord, newWordBag, THEMES, toggleThemeSelection, setExtraWords } from '../lib/words';
import { loadCustomWords } from '../lib/customwords';
import { processKey, type PlayerState } from '../lib/engine';
import { sfx, resumeAudio, setSfxEnabled } from '../lib/sfx';
import { ITEM_CAT, ITEM_KIND, ITEM_RARITY, CAT_META, CAT_ORDER, USE_MODES, type ItemCat, type UseMode } from '../lib/items';
import { loadKeyConfig, keyLabel, type KeyConfig } from '../lib/keyconfig';
import PlayerSettings from './PlayerSettings';
import type { Dummy, GameStatus, ItemType, TargetMode, Word } from '../lib/types';
import MiniBoard from './MiniBoard';
import CurrentWord from './CurrentWord';
import AttackGauge from './AttackGauge';

// --- 定数 ---
const MAX_BACKLOG = 12;
const INITIAL_SPAWN_INTERVAL = 4000;
const MIN_SPAWN_INTERVAL = 1000;
const DEFAULT_ACCEL = 0.98; // 1供給ごとの間隔倍率
const DUMMY_COUNT = 20;
const BRAKE_DURATION = 5000;
const ATTACK_CAP = 5; // 1回の攻撃量の上限（即死コンボ防止）
const RAPID_DURATION = 8000; // 連射アイテムの効果時間
const KEEP_DURATION = 10000; // 連鎖キープ（ミスで連鎖が切れない）の効果時間
const PARRY_DURATION = 8000; // 受け流し（被攻撃を逸らす）の効果時間
const TOTEM_DURATION = 12000; // 不死のトーテム（上限超過無効）の効果時間
const ATTACK_THRESHOLD = 5; // 何クリアごとに攻撃を発射するか（初期値）
const TELEGRAPH_DELAY = 2500; // CPU攻撃の着弾予告→確定までの猶予（相殺の反応時間を確保）
const CFG_KEY = 'typeRoyale.custom'; // カスタム設定の保存キー

const FREEZE_DURATION = 5000; // フリーズ（着弾予告と自動供給を停止）の効果時間

// 時間制限つきアイテムの効果時間（カウントダウンゲージ用）。
const ITEM_DURATION: Partial<Record<ItemType, number>> = {
  brake: BRAKE_DURATION,
  rapid: RAPID_DURATION,
  keep: KEEP_DURATION,
  parry: PARRY_DURATION,
  totem: TOTEM_DURATION,
  freeze: FREEZE_DURATION,
};

const ITEM_META: Record<ItemType, { name: string; icon: string; desc: string }> = {
  shield: { name: 'シールド', icon: '🛡', desc: '次の自動供給を1回無効化' },
  clear: { name: 'おじゃま一掃', icon: '🌀', desc: 'バックログのおじゃまを消す' },
  brake: { name: 'ブレーキ', icon: '⏸', desc: '自動供給を5秒間ストップ' },
  longbomb: { name: 'ロング送信', icon: '📨', desc: '敵へ長文おじゃま(相殺不可)を送る' },
  rapid: { name: '連射', icon: '⚡', desc: '8秒間 1クリアごとにおじゃま+1' },
  keep: { name: '連鎖キープ', icon: '🔒', desc: '10秒間ミスしても連鎖が切れない' },
  shrink: { name: '短縮', icon: '✂', desc: '溜まったワードを全て短い単語に変換' },
  parry: { name: '受け流し', icon: '🪃', desc: '8秒間 被攻撃を他の相手へ逸らす' },
  gaugedown: { name: 'ゲージ短縮', icon: '⏬', desc: '攻撃が4クリアごとに発射(恒久・一個まで)' },
  totem: { name: '不死のトーテム', icon: '🗿', desc: '12秒間 上限超過しても脱落しない(自動発動)' },
  // ボスモード専用（ソロでは出現しない）。
  meteor: { name: 'メテオ', icon: '🌠', desc: 'ボス: 全挑戦者へ一斉攻撃' },
  quake: { name: '地割れ', icon: '🌋', desc: 'ボス: 最も危険な挑戦者へトドメ' },
  regen: { name: '再生', icon: '💚', desc: 'ボス: 自分のHPを回復' },
  rally: { name: '総攻撃', icon: '⚔', desc: '挑戦者: ボスへ即時の大攻撃' },
  focus: { name: '会心', icon: '🎯', desc: '挑戦者: 次のボスへの攻撃を倍化' },
  // 防御
  barrier: { name: 'バリア', icon: '🛡️', desc: '次の被弾を1回まるごと防ぐ' },
  freeze: { name: 'フリーズ', icon: '🧊', desc: '5秒間 被攻撃を無効化＋自動供給を停止' },
  purge: { name: '大掃除', icon: '🧹', desc: 'バックログを全消去（逆転のチャンス）' },
  guard: { name: '超シールド', icon: '🧱', desc: 'シールドの上位互換。自動供給を2回ぶん防ぐ' },
  // 攻撃（送る数字は全ておじゃまの数）
  snipe: { name: '狙撃', icon: '🎯', desc: '最も危険な相手にトドメの一撃（おじゃま+4）' },
  burst: { name: 'バースト', icon: '💥', desc: '全ての相手へおじゃま+2' },
  heavy: { name: '強撃', icon: '🔨', desc: '連鎖に応じたおじゃまを即送信' },
  flood: { name: 'フラッド', icon: '🌊', desc: '狙った相手へ濁流の大量おじゃま+7' },
  drain: { name: 'ドレイン', icon: '🩸', desc: '自分を2減らし相手へおじゃま+2' },
  mirror: { name: 'ミラー', icon: '🪞', desc: '不利なほど強いおじゃまを送る' },
  // お宝/HP
  goldify: { name: 'ゴールド化', icon: '✨', desc: '溜まっているワードを全てお宝に変える' },
  luck: { name: '幸運', icon: '🍀', desc: 'お宝の出現率が上がる（永続）' },
  maxhp: { name: 'HPアップ', icon: '❤️', desc: 'HP(積載上限)+1（永続・最大+3）' },
  // オンライン専用（ソロには出現しない）
  reflect: { name: 'リフレクト', icon: '🪞', desc: '一定時間 受けた攻撃を送り主へ跳ね返す' },
  overcharge: { name: 'オーバーチャージ', icon: '🔋', desc: '一定時間 アタックゲージが倍速で溜まる' },
  thunder: { name: 'サンダーボルト', icon: '⚡', desc: '首位の相手へ落雷の大ダメージ' },
  jammer: { name: 'ジャマー', icon: '📡', desc: '全相手へ長文おじゃまを送りつける' },
  siphon: { name: 'サイフォン', icon: '🧛', desc: '一定時間 攻撃が当たるたび自分のHPが回復' },
  dazzle: { name: '視認性低下', icon: '🌈', desc: '一定時間 狙った相手の画面をゲーミングに光らせる' },
};
const ITEM_EMOJI: Record<ItemType, string> = {
  shield: '🛡', clear: '🌀', brake: '⏸', longbomb: '📨', rapid: '⚡', keep: '🔒',
  shrink: '✂', parry: '🪃', gaugedown: '⏬', totem: '🗿',
  meteor: '🌠', quake: '🌋', regen: '💚', rally: '⚔', focus: '🎯',
  barrier: '🛡️', freeze: '🧊', purge: '🧹', guard: '🧱',
  snipe: '🎯', burst: '💥', heavy: '🔨', flood: '🌊', drain: '🩸', mirror: '🪞',
  goldify: '✨', luck: '🍀', maxhp: '❤️',
  reflect: '🪞', overcharge: '🔋', thunder: '⚡', jammer: '📡', siphon: '🧛', dazzle: '🌈',
};
// プレイ中にドロップするアイテム（統合・削除した shield/clear/heavy/mirror は除外）。
const ALL_ITEMS: ItemType[] = [
  'brake', 'longbomb', 'rapid', 'keep', 'shrink', 'parry', 'gaugedown', 'totem',
  // 追加アイテム（防御/攻撃/妨害）
  'barrier', 'freeze', 'purge', 'guard', 'snipe', 'burst', 'flood', 'drain',
  // 追加アイテム（お宝/HP）
  'goldify', 'luck', 'maxhp',
];
const MAX_HP_UP = 3; // HPアップの取得上限（永続）
// ストックされている単語を変化させる系アイテム（発動を分かりやすく強調する）。
const BOARD_CHANGE_ITEMS = new Set<ItemType>(['purge', 'shrink', 'goldify', 'clear', 'drain']);


const MAX_DUMMIES = 30; // 敵数の上限（名前プールの都合）
const HP_MIN = 6;
const HP_MAX = 24;

// カスタム設定の永続化（タイトルに戻ってもリセットされない）。
interface CustomCfg {
  initial: number; min: number; accel: number; theme: string; hp: number; enemies: number;
  cpuStr: number; // CPUの平均的な強さ 0〜10
  treasureRate: number; // お宝の出現率（%）
  attackGauge: number; // 何クリアで攻撃を発射するか（ゲージの数）
  attackCap: number; // 1回の攻撃量の上限
  comboStep: number; // 何連鎖ごとに攻撃量が+1されるか
  badgeCap: number; // バッジ補正の上限枚数
  badgeRate: number; // バッジ1枚あたりの攻撃量上昇率(%)
  gaugeMode: 'word' | 'char'; // ゲージ加算方式（ワード数 or 文字数）
  gaugeChars: number; // 文字数方式のときの発射しきい値（何文字で発射）
  comeback: number; // 逆転補正の強さ（0=なし〜3=強）。有利不利でアイテム傾向を変える
  autoFull: boolean; // 完全オート（有利不利を見て自動で使用）
  use: Record<ItemCat, UseMode>; // カテゴリ別の使い方（保持/即時）
  itemsOn: boolean; // アイテム全体のON/OFF（OFFならお宝・アイテムが一切出ない）
}
const validMode = (v: unknown): UseMode => (v === 'instant' ? 'instant' : 'hold');
function loadCfg(): CustomCfg {
  const def: CustomCfg = {
    initial: INITIAL_SPAWN_INTERVAL, min: MIN_SPAWN_INTERVAL, accel: DEFAULT_ACCEL,
    theme: 'all', hp: MAX_BACKLOG, enemies: DUMMY_COUNT, cpuStr: 5, treasureRate: 20,
    attackGauge: ATTACK_THRESHOLD, attackCap: ATTACK_CAP, comboStep: 5,
    badgeCap: 4, badgeRate: 25,
    gaugeMode: 'word', gaugeChars: 16, comeback: 2,
    autoFull: false, use: { attack: 'hold', defense: 'hold', timed: 'hold' },
    itemsOn: true,
  };
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      return {
        initial: typeof o.initial === 'number' ? o.initial : def.initial,
        min: typeof o.min === 'number' ? o.min : def.min,
        accel: typeof o.accel === 'number' ? o.accel : def.accel,
        theme: typeof o.theme === 'string' ? o.theme : def.theme,
        hp: typeof o.hp === 'number' ? Math.min(HP_MAX, Math.max(HP_MIN, o.hp)) : def.hp,
        enemies: typeof o.enemies === 'number' ? Math.min(MAX_DUMMIES, Math.max(1, o.enemies)) : def.enemies,
        cpuStr: typeof o.cpuStr === 'number' ? Math.min(10, Math.max(0, o.cpuStr)) : def.cpuStr,
        treasureRate: typeof o.treasureRate === 'number' ? Math.min(80, Math.max(0, o.treasureRate)) : def.treasureRate,
        attackGauge: typeof o.attackGauge === 'number' ? Math.min(10, Math.max(2, o.attackGauge)) : def.attackGauge,
        attackCap: typeof o.attackCap === 'number' ? Math.min(12, Math.max(2, o.attackCap)) : def.attackCap,
        comboStep: typeof o.comboStep === 'number' ? Math.min(15, Math.max(2, o.comboStep)) : def.comboStep,
        badgeCap: typeof o.badgeCap === 'number' ? Math.min(10, Math.max(0, o.badgeCap)) : def.badgeCap,
        badgeRate: typeof o.badgeRate === 'number' ? Math.min(100, Math.max(0, o.badgeRate)) : def.badgeRate,
        gaugeMode: o.gaugeMode === 'char' ? 'char' : 'word',
        gaugeChars: typeof o.gaugeChars === 'number' ? Math.min(40, Math.max(6, o.gaugeChars)) : def.gaugeChars,
        comeback: typeof o.comeback === 'number' ? Math.min(3, Math.max(0, o.comeback)) : def.comeback,
        autoFull: typeof o.autoFull === 'boolean' ? o.autoFull : def.autoFull,
        use: o.use && typeof o.use === 'object'
          ? { attack: validMode(o.use.attack), defense: validMode(o.use.defense), timed: validMode(o.use.timed ?? o.use.disrupt) }
          : def.use,
        itemsOn: typeof o.itemsOn === 'boolean' ? o.itemsOn : def.itemsOn,
      };
    }
  } catch { /* localStorage 不可環境は既定値 */ }
  return def;
}

// CPU名（足りない分は連番で補う）。
const cpuName = (i: number): string => CPU_NAMES[i] ?? `CPU${i + 1}`;

const TARGET_MODES: { mode: TargetMode; label: string }[] = [
  { mode: 'random', label: 'ランダム' },
  { mode: 'counter', label: '反撃' },
  { mode: 'finish', label: 'とどめ' },
  { mode: 'strong', label: '強敵' },
];

interface Telegraph { id: number; amount: number; confirmAt: number; word?: { display: string; reading: string }; }

const CPU_NAMES = [
  'タイピー', 'カナ丸', 'ローマ', 'ことだま', 'はやて', 'シフト', 'エンター', 'スペース',
  'バックスペース', 'キャップス', 'コンボ', 'チェイン', 'おじゃま', 'おたから', 'シールド',
  'ブレーキ', 'ラピッド', 'ボム', 'ターゲット', 'ロイヤル',
  // 21〜30人目以降の名前
  'クイック', 'フラッシュ', 'ミラージュ', 'サンダー', 'ブリッツ', 'ノヴァ', 'ゼロ', 'アルファ',
  'オメガ', 'ファントム', 'クリムゾン', 'コメット', 'ストライク', 'ヴァイパー', 'ジェット',
];

export default function SoloGame({ onExit }: { onExit: () => void }) {
  const initialCfg = loadCfg();
  const [gameState, setGameState] = useState<GameStatus>('start');

  const [backlog, setBacklog] = useState<PlayerState['backlog']>([]);
  const [tokenIndex, setTokenIndex] = useState(0);
  const [currentTyping, setCurrentTyping] = useState('');
  const [typedRomaji, setTypedRomaji] = useState<string[]>([]); // 現在ワードで実際に打った綴り（確定表示の保持）
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [score, setScore] = useState(0);
  const [keysTyped, setKeysTyped] = useState(0);
  const [missCount, setMissCount] = useState(0); // ミスタイプ数（リザルト用）
  const [startTime, setStartTime] = useState<number | null>(null);
  const [endTime, setEndTime] = useState<number | null>(null); // ゲーム終了時刻（KPM固定用）
  const [spawnInterval, setSpawnInterval] = useState(INITIAL_SPAWN_INTERVAL);
  const [seed, setSeed] = useState(0);
  // カスタム: HP（積載限界）と敵数。
  const [maxBacklog, setMaxBacklog] = useState(initialCfg.hp);
  const [dummyCount, setDummyCount] = useState(initialCfg.enemies);
  const maxBacklogRef = useRef(initialCfg.hp);
  const treasureBoostRef = useRef(0); // 幸運(luck)によるお宝出現率の永続上昇分
  const hpUpCountRef = useRef(0); // HPアップ(maxhp)の取得回数（上限 MAX_HP_UP）

  const [playerKOs, setPlayerKOs] = useState(0);
  const playerKOsRef = useRef(0);
  useEffect(() => { playerKOsRef.current = playerKOs; }, [playerKOs]);
  // アイテムは攻撃/防御/妨害の3スロットで保持。Spaceで選択切替、Enterで発動。
  const [slots, setSlots] = useState<Record<ItemCat, ItemType | null>>({ attack: null, defense: null, timed: null });
  const [selectedSlot, setSelectedSlot] = useState<ItemCat>('attack');

  const [missFlash, setMissFlash] = useState(false);
  const [romajiHint, setRomajiHint] = useState(false); // ミス時のみ表示モードで、ミス後にローマ字を出す
  const [itemFlash, setItemFlash] = useState(false);
  const [attackFlash, setAttackFlash] = useState<{ amount: number; name: string } | null>(null);
  const [hitDummy, setHitDummy] = useState<number | null>(null);
  const [incomingDummy, setIncomingDummy] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [theme, setTheme] = useState(initialCfg.theme);
  const [attackThreshold, setAttackThreshold] = useState(ATTACK_THRESHOLD); // ゲージ短縮で 5→4
  const [nowTick, setNowTick] = useState(0); // カウントダウン描画用の時刻（効果の発動中判定にも使う）
  const [attackProgress, setAttackProgress] = useState(0); // 次の攻撃までのゲージ（ミスで減らない）
  const [targetMode, setTargetMode] = useState<TargetMode>('random');
  // 受信予告（CPUからの攻撃）
  const [pending, setPending] = useState<Telegraph[]>([]);
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: 'ko' | 'in' | 'item'; at: number }[]>([]);
  const [selfLog, setSelfLog] = useState<{ id: number; item: ItemType; at: number }[]>([]); // 自分のアイテム使用履歴
  const [damageFlash, setDamageFlash] = useState(false);
  // エフェクト用
  const [beams, setBeams] = useState<{ id: number; x1: number; y1: number; x2: number; y2: number; color: string }[]>([]);
  const [shake, setShake] = useState(false);
  const [useFlash, setUseFlash] = useState<ItemType | null>(null);
  const [boardFx, setBoardFx] = useState<ItemType | null>(null); // 盤面変化系の強調演出
  const [parryFx, setParryFx] = useState(false); // 受け流し成功エフェクト
  const [showSettings, setShowSettings] = useState(false); // プレイヤー設定モーダル
  const [keyCfg, setKeyCfg] = useState<KeyConfig>(() => loadKeyConfig());
  const keyConfigRef = useRef<KeyConfig>(keyCfg);
  useEffect(() => { keyConfigRef.current = keyCfg; }, [keyCfg]);
  const settingsOpenRef = useRef(false);
  useEffect(() => { settingsOpenRef.current = showSettings; }, [showSettings]);
  const centerRef = useRef<HTMLDivElement>(null);
  const dummyRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const beamIdRef = useRef(0);
  const toastIdRef = useRef(0);
  const telegraphIdRef = useRef(0);

  const addBeam = useCallback((x1: number, y1: number, x2: number, y2: number, color: string) => {
    const id = beamIdRef.current++;
    setBeams((b) => [...b, { id, x1, y1, x2, y2, color }]);
    setTimeout(() => setBeams((b) => b.filter((x) => x.id !== id)), 700);
  }, []);

  const pushToast = useCallback((text: string, kind: 'ko' | 'in' | 'item') => {
    const id = toastIdRef.current++;
    // 直近の履歴として残す（ログ表示用）。古いものから自動で消える。
    setToasts((t) => [...t, { id, text, kind, at: Date.now() }].slice(-24));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  // カスタムモードの設定（永続化された値で初期化）
  const [cfgInitial, setCfgInitial] = useState(initialCfg.initial);
  const [cfgMin, setCfgMin] = useState(initialCfg.min);
  const [cfgAccel, setCfgAccel] = useState(initialCfg.accel);
  const [cfgHp, setCfgHp] = useState(initialCfg.hp);
  const [cfgEnemies, setCfgEnemies] = useState(initialCfg.enemies);
  const [cfgCpuStr, setCfgCpuStr] = useState(initialCfg.cpuStr);
  const [cfgTreasureRate, setCfgTreasureRate] = useState(initialCfg.treasureRate);
  const [cfgAttackGauge, setCfgAttackGauge] = useState(initialCfg.attackGauge);
  const [cfgAttackCap, setCfgAttackCap] = useState(initialCfg.attackCap);
  const [cfgComboStep, setCfgComboStep] = useState(initialCfg.comboStep);
  const [cfgBadgeCap, setCfgBadgeCap] = useState(initialCfg.badgeCap);
  const [cfgBadgeRate, setCfgBadgeRate] = useState(initialCfg.badgeRate);
  const [cfgGaugeMode, setCfgGaugeMode] = useState<'word' | 'char'>(initialCfg.gaugeMode);
  const [cfgGaugeChars, setCfgGaugeChars] = useState(initialCfg.gaugeChars);
  const [cfgComeback, setCfgComeback] = useState(initialCfg.comeback);
  const [cfgAutoFull, setCfgAutoFull] = useState(initialCfg.autoFull);
  const [cfgUse, setCfgUse] = useState<Record<ItemCat, UseMode>>(initialCfg.use);
  const [cfgItemsOn, setCfgItemsOn] = useState(initialCfg.itemsOn);
  // 設定が変わるたび localStorage に保存（タイトルに戻ってもリセットされない）。
  useEffect(() => {
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify({
        initial: cfgInitial, min: cfgMin, accel: cfgAccel, theme, hp: cfgHp, enemies: cfgEnemies, cpuStr: cfgCpuStr,
        treasureRate: cfgTreasureRate, attackGauge: cfgAttackGauge, attackCap: cfgAttackCap, comboStep: cfgComboStep,
        badgeCap: cfgBadgeCap, badgeRate: cfgBadgeRate, gaugeMode: cfgGaugeMode, gaugeChars: cfgGaugeChars, comeback: cfgComeback,
        autoFull: cfgAutoFull, use: cfgUse, itemsOn: cfgItemsOn,
      }));
    } catch { /* 保存不可環境は無視 */ }
  }, [cfgInitial, cfgMin, cfgAccel, theme, cfgHp, cfgEnemies, cfgCpuStr, cfgTreasureRate, cfgAttackGauge, cfgAttackCap, cfgComboStep, cfgBadgeCap, cfgBadgeRate, cfgGaugeMode, cfgGaugeChars, cfgComeback, cfgAutoFull, cfgUse, cfgItemsOn]);
  const attackCapRef = useRef(initialCfg.attackCap);
  const comboStepRef = useRef(initialCfg.comboStep);
  const badgeCapRef = useRef(initialCfg.badgeCap);
  const badgeRateRef = useRef(initialCfg.badgeRate);
  const gaugeModeRef = useRef(initialCfg.gaugeMode);
  const gaugeCharsRef = useRef(initialCfg.gaugeChars);
  const comebackRef = useRef(initialCfg.comeback);
  useEffect(() => { comebackRef.current = cfgComeback; }, [cfgComeback]);
  useEffect(() => { attackCapRef.current = cfgAttackCap; }, [cfgAttackCap]);
  useEffect(() => { comboStepRef.current = cfgComboStep; }, [cfgComboStep]);
  useEffect(() => { badgeCapRef.current = cfgBadgeCap; }, [cfgBadgeCap]);
  useEffect(() => { badgeRateRef.current = cfgBadgeRate; }, [cfgBadgeRate]);
  useEffect(() => { gaugeModeRef.current = cfgGaugeMode; }, [cfgGaugeMode]);
  useEffect(() => { gaugeCharsRef.current = cfgGaugeChars; }, [cfgGaugeChars]);
  const cpuStrengthRef = useRef(initialCfg.cpuStr / 10); // 0..1 の目標強さ
  const treasureRateRef = useRef(initialCfg.treasureRate / 100); // お宝の基本出現率（0..1）
  useEffect(() => { treasureRateRef.current = cfgTreasureRate / 100; }, [cfgTreasureRate]);
  const itemsOnRef = useRef(initialCfg.itemsOn); // アイテムON/OFF（OFFならお宝もアイテムも出さない）
  useEffect(() => { itemsOnRef.current = cfgItemsOn; }, [cfgItemsOn]);
  // ゲーム中に参照するための ref（設定はスタート画面で変える想定）。
  const autoFullRef = useRef(cfgAutoFull);
  const useModeRef = useRef(cfgUse);
  useEffect(() => { autoFullRef.current = cfgAutoFull; }, [cfgAutoFull]);
  useEffect(() => { useModeRef.current = cfgUse; }, [cfgUse]);
  const accelRef = useRef(DEFAULT_ACCEL);
  const minRef = useRef(MIN_SPAWN_INTERVAL);
  const rapidUntilRef = useRef(0);
  const keepUntilRef = useRef(0);
  const parryUntilRef = useRef(0);
  const totemUntilRef = useRef(0);
  const freezeUntilRef = useRef(0); // フリーズ（着弾予告/供給停止）
  const barrierRef = useRef(false); // バリア（次の被弾を1回防ぐ）
  const guardCountRef = useRef(0); // ガード（自動供給を複数回防ぐ）
  const attackThresholdRef = useRef(ATTACK_THRESHOLD);
  const gaugeDownObtainedRef = useRef(false); // ゲージ短縮は一人一個まで
  const attackProgressRef = useRef(0);
  const bagRef = useRef(newWordBag()); // 出題バッグ（全語を1巡するまで重複させない）
  const themeRef = useRef(theme);
  useEffect(() => { themeRef.current = theme; }, [theme]);
  const targetModeRef = useRef(targetMode);
  useEffect(() => { targetModeRef.current = targetMode; }, [targetMode]);
  const lastAttackerRef = useRef<number | null>(null);

  // 出題バッグから次の単語を生成（全語を1巡するまで重複しない）。
  const nextWord = useCallback((): Word => {
    const rng = wordRngRef.current!;
    return generateWord(rng, themeRef.current, bagRef.current, false, itemsOnRef.current ? treasureRateRef.current : 0, treasureBoostRef.current);
  }, []);
  const pendingRef = useRef<Telegraph[]>([]);
  const updatePending = useCallback((next: Telegraph[]) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  const [dummies, setDummies] = useState<Dummy[]>(
    Array.from({ length: initialCfg.enemies }).map((_, i) => ({ id: i, height: 0, isKO: false, name: cpuName(i), combo: 0, atk: 0 })),
  );

  const stateRef = useRef<PlayerState>({ backlog, tokenIndex, currentTyping, combo, gameState });
  useEffect(() => {
    stateRef.current = { backlog, tokenIndex, currentTyping, combo, gameState };
  }, [backlog, tokenIndex, currentTyping, combo, gameState]);

  const dummiesRef = useRef(dummies);
  useEffect(() => { dummiesRef.current = dummies; }, [dummies]);

  const slotsRef = useRef(slots);
  useEffect(() => { slotsRef.current = slots; }, [slots]);
  const selectedSlotRef = useRef(selectedSlot);
  useEffect(() => { selectedSlotRef.current = selectedSlot; }, [selectedSlot]);
  const setSlot = useCallback((cat: ItemCat, val: ItemType | null) => {
    setSlots((s) => ({ ...s, [cat]: val }));
    slotsRef.current = { ...slotsRef.current, [cat]: val };
  }, []);

  const wordRngRef = useRef<RNG | null>(null);
  const itemRngRef = useRef<RNG | null>(null);
  const shieldRef = useRef(false);
  const brakeUntilRef = useRef(0);

  // CPUに攻撃を受けた演出（赤ビーム＋画面赤フラッシュ＋シェイク）。
  const fireIncoming = useCallback((fromId: number) => {
    setIncomingDummy(fromId);
    setTimeout(() => setIncomingDummy((cur) => (cur === fromId ? null : cur)), 650);
    setDamageFlash(true);
    setTimeout(() => setDamageFlash(false), 220);
    const from = dummyRefs.current[fromId]?.getBoundingClientRect();
    const to = centerRef.current?.getBoundingClientRect();
    if (from && to) {
      addBeam(from.left + from.width / 2, from.top + from.height / 2, to.left + to.width / 2, to.top + to.height * 0.35, '#ef4444');
    }
  }, [addBeam]);

  // ターゲット選択（4モード）。
  const pickTarget = useCallback((): Dummy | null => {
    const alive = dummiesRef.current.filter((d) => !d.isKO);
    if (alive.length === 0) return null;
    const mode = targetModeRef.current;
    if (mode === 'counter') {
      const found = alive.find((d) => d.id === lastAttackerRef.current);
      if (found) return found;
    } else if (mode === 'finish') {
      return alive.reduce((best, cur) => (cur.height > best.height ? cur : best));
    } else if (mode === 'strong') {
      return alive.reduce((best, cur) => ((cur.atk ?? 0) > (best.atk ?? 0) ? cur : best));
    }
    return alive[Math.floor(Math.random() * alive.length)];
  }, []);

  // 防御の相殺: 来ている着弾予告を n だけ打ち消す（長文は対象外）。
  // 「1クリアごとに1相殺」でタイピングそのものを防御にする。
  const offsetIncoming = useCallback((n: number) => {
    if (n <= 0 || pendingRef.current.length === 0) return;
    let remaining = n;
    const sorted = [...pendingRef.current].sort((a, b) => a.confirmAt - b.confirmAt);
    let changed = false;
    for (const e of sorted) {
      if (remaining <= 0) break;
      if (e.word) continue; // 長文は相殺不可
      const cut = Math.min(remaining, e.amount);
      if (cut > 0) { e.amount -= cut; remaining -= cut; changed = true; }
    }
    if (changed) updatePending(sorted.filter((e) => e.amount > 0 || e.word));
  }, [updatePending]);

  // 指定量を攻撃: まず受信予告と相殺 → 余剰をターゲットへ。
  // forcedTarget を渡すと 狙い設定を無視して特定の相手へ撃つ（狙撃のトドメ用）。
  const fireAttack = useCallback((amount: number, forcedTarget?: Dummy | null) => {
    if (amount <= 0) return;
    // 相殺（ただし長文＝ロング送信は相殺対象外で必ず着弾する）。
    let remaining = amount;
    const sorted = [...pendingRef.current].sort((a, b) => a.confirmAt - b.confirmAt);
    for (const e of sorted) {
      if (remaining <= 0) break;
      if (e.word) continue; // 長文は打ち消せない
      const cut = Math.min(remaining, e.amount);
      e.amount -= cut;
      remaining -= cut;
    }
    updatePending(sorted.filter((e) => e.amount > 0 || e.word));
    sfx.attack();
    if (remaining <= 0) {
      setAttackFlash({ amount: 0, name: '相殺！' });
      setTimeout(() => setAttackFlash(null), 600);
      return;
    }
    const target = (forcedTarget && !forcedTarget.isKO) ? forcedTarget : pickTarget();
    if (!target) return;
    const willKO = target.height + remaining > maxBacklogRef.current;
    setDummies((prev) =>
      prev.map((d) =>
        d.id === target.id ? (willKO ? { ...d, height: 0, isKO: true } : { ...d, height: d.height + remaining }) : d,
      ),
    );
    if (willKO) {
      setPlayerKOs((k) => k + 1);
      pushToast(`${target.name} を撃破！`, 'ko');
      sfx.ko();
    }
    setAttackFlash({ amount: remaining, name: target.name ?? '' });
    setHitDummy(target.id);
    const from = centerRef.current?.getBoundingClientRect();
    const to = dummyRefs.current[target.id]?.getBoundingClientRect();
    if (from && to) {
      addBeam(from.left + from.width / 2, from.top + from.height * 0.35, to.left + to.width / 2, to.top + to.height / 2, '#fb923c');
    }
    setTimeout(() => setAttackFlash(null), 600);
    setTimeout(() => setHitDummy((cur) => (cur === target.id ? null : cur)), 600);
  }, [addBeam, pickTarget, pushToast, updatePending]);

  // アイテムの効果を適用（所持状態のクリアは行わない）。
  const applyItem = useCallback(
    (item: ItemType) => {
      setUseFlash(item);
      setTimeout(() => setUseFlash(null), 900);
      // 自分のアイテム使用ログ（効果説明つき）。
      {
        const lid = toastIdRef.current++;
        setSelfLog((l) => [...l, { id: lid, item, at: Date.now() }].slice(-24));
        setTimeout(() => setSelfLog((l) => l.filter((x) => x.id !== lid)), 6000);
      }
      // ストックされた単語が変化する系は、気づかず古い単語を打ってしまわないよう強調表示。
      if (BOARD_CHANGE_ITEMS.has(item)) {
        setBoardFx(item);
        setTimeout(() => setBoardFx((cur) => (cur === item ? null : cur)), 1300);
      }
      if (item === 'shield') shieldRef.current = true;
      else if (item === 'brake') brakeUntilRef.current = Date.now() + BRAKE_DURATION;
      else if (item === 'clear')
        setBacklog((prev) => (prev.length <= 1 ? prev : [prev[0], ...prev.slice(1).filter((w) => w.type !== 'ojama')]));
      else if (item === 'longbomb') fireAttack(6); // 敵CPUへの大ダメージ攻撃
      else if (item === 'rapid') {
        rapidUntilRef.current = Date.now() + RAPID_DURATION;
      } else if (item === 'keep') {
        keepUntilRef.current = Date.now() + KEEP_DURATION;
      } else if (item === 'shrink') {
        // 溜まっているワード（処理待ちの山）を全て短い単語に変換して打ちやすくする。
        // いま打っている先頭(index 0)はそのまま残す。
        setBacklog((prev) => prev.map((w, i) => (i === 0 ? w : makeShortWord(w.type, themeRef.current))));
      } else if (item === 'parry') {
        parryUntilRef.current = Date.now() + PARRY_DURATION;
      } else if (item === 'gaugedown') {
        attackThresholdRef.current = Math.max(2, attackThresholdRef.current - 1);
        setAttackThreshold(attackThresholdRef.current);
      } else if (item === 'totem') {
        totemUntilRef.current = Date.now() + TOTEM_DURATION;
      }
      // --- 防御 ---
      else if (item === 'barrier') barrierRef.current = true;
      else if (item === 'freeze') freezeUntilRef.current = Date.now() + FREEZE_DURATION;
      else if (item === 'guard') guardCountRef.current = 2;
      else if (item === 'purge') {
        // 大掃除: バックログを丸ごと空にし、簡単な単語を1つだけ残す（逆転のチャンス）。
        setBacklog([makeShortWord('normal', themeRef.current)]);
        setTokenIndex(0);
        setCurrentTyping('');
        setTypedRomaji([]);
      }
      // --- 攻撃 ---
      else if (item === 'snipe') {
        // 狙撃: 最も危険な（積もっている）相手にトドメの一撃。狙い設定を無視。
        const alive = dummiesRef.current.filter((d) => !d.isKO);
        const mostLoaded = alive.length ? alive.reduce((b, c) => (c.height > b.height ? c : b)) : null;
        fireAttack(4, mostLoaded);
      }
      else if (item === 'heavy') fireAttack(Math.min(Math.max(2, Math.floor(stateRef.current.combo / 3)), 6));
      else if (item === 'burst') {
        // 全ての敵CPUへ一斉に +2。
        const inc = 2;
        const targets = dummiesRef.current.filter((d) => !d.isKO);
        const cap = maxBacklogRef.current;
        const koIds = targets.filter((d) => d.height + inc > cap).map((d) => d.id);
        setDummies((prev) =>
          prev.map((d) => (!d.isKO ? (d.height + inc > cap ? { ...d, height: 0, isKO: true } : { ...d, height: d.height + inc }) : d)),
        );
        if (koIds.length) {
          setPlayerKOs((k) => k + koIds.length);
          sfx.ko();
        }
        const from = centerRef.current?.getBoundingClientRect();
        // 生存している全ての敵へビームを飛ばす（取りこぼしなく全体攻撃を可視化）。
        for (const d of targets) {
          const to = dummyRefs.current[d.id]?.getBoundingClientRect();
          if (from && to) addBeam(from.left + from.width / 2, from.top + from.height * 0.35, to.left + to.width / 2, to.top + to.height / 2, '#fb923c');
        }
        sfx.attack();
        pushToast('バースト！ 全体+2', 'item');
      }
      // --- 妨害 ---
      else if (item === 'flood') fireAttack(7); // フラッド: 狙い相手へ濁流の大量おじゃま
      else if (item === 'mirror') fireAttack(Math.min(Math.max(1, Math.floor(stateRef.current.backlog.length / 3)), 6));
      else if (item === 'drain') {
        setBacklog((prev) => (prev.length <= 1 ? prev : [prev[0], ...prev.slice(1, Math.max(1, prev.length - 2))]));
        fireAttack(2);
      }
      // --- お宝/HP ---
      else if (item === 'goldify') {
        // 溜まっているワードを全てお宝に変える（先頭も含む）。
        setBacklog((prev) => prev.map((w) => (w.type === 'ojama' ? w : { ...w, type: 'treasure' as const })));
        pushToast('ゴールド化！ 全ワードがお宝に', 'item');
      } else if (item === 'luck') {
        // お宝出現率を永続的に上昇（上限 +0.5）。
        treasureBoostRef.current = Math.min(0.5, treasureBoostRef.current + 0.08);
        pushToast('幸運！ お宝の出現率アップ', 'item');
      } else if (item === 'maxhp') {
        // HP(積載上限)を永続的に+1（上限 MAX_HP_UP）。
        if (hpUpCountRef.current < MAX_HP_UP) {
          hpUpCountRef.current += 1;
          maxBacklogRef.current += 1;
          setMaxBacklog(maxBacklogRef.current);
          pushToast('HPアップ！ 積載上限+1', 'item');
        }
      }
    },
    [fireAttack, addBeam, pushToast],
  );

  // 受け流し: 確定したおじゃまをプレイヤーに入れず、ランダムな敵CPUへ逸らす。
  const deflectToCpu = useCallback(
    (amount: number) => {
      if (amount <= 0) return;
      const alive = dummiesRef.current.filter((d) => !d.isKO);
      if (alive.length === 0) return;
      const target = alive[Math.floor(Math.random() * alive.length)];
      const willKO = target.height + amount > maxBacklogRef.current;
      setDummies((prev) =>
        prev.map((d) =>
          d.id === target.id ? (willKO ? { ...d, height: 0, isKO: true } : { ...d, height: d.height + amount }) : d,
        ),
      );
      if (willKO) {
        setPlayerKOs((k) => k + 1);
        pushToast(`${target.name} を撃破！`, 'ko');
        sfx.ko();
      }
      setHitDummy(target.id);
      setTimeout(() => setHitDummy((cur) => (cur === target.id ? null : cur)), 600);
      const from = centerRef.current?.getBoundingClientRect();
      const to = dummyRefs.current[target.id]?.getBoundingClientRect();
      if (from && to) {
        addBeam(from.left + from.width / 2, from.top + from.height * 0.35, to.left + to.width / 2, to.top + to.height / 2, '#a78bfa');
      }
    },
    [addBeam, pushToast],
  );

  // 上限超過時の保護。トーテム発動中なら無効化、所持中なら自動発動、無ければ脱落。
  const overflowProtect = useCallback((): 'protected' | 'gameover' => {
    if (Date.now() < totemUntilRef.current) return 'protected';
    // トーテムは防御スロットに入る。所持していれば自動発動して脱落を防ぐ。
    if (slotsRef.current.defense === 'totem') {
      totemUntilRef.current = Date.now() + TOTEM_DURATION;
      setSlot('defense', null);
      setUseFlash('totem');
      setTimeout(() => setUseFlash(null), 900);
      sfx.use();
      pushToast('不死のトーテム発動！', 'item');
      return 'protected';
    }
    return 'gameover';
  }, [pushToast, setSlot]);

  const grantItem = useCallback(() => {
    const rng = itemRngRef.current;
    const r = rng ? rng() : Math.random();
    // 有利不利の指標 = 自分のピンチ度（バックログ量）と、生存者中の順位を半々で合成。
    const pinch = Math.min(1, stateRef.current.backlog.length / maxBacklogRef.current);
    const alive = dummiesRef.current.filter((d) => !d.isKO);
    const myH = stateRef.current.backlog.length;
    const behind = alive.filter((d) => d.height < myH).length; // 自分より高さが低い（＝有利な）敵の数
    const rankBehind = alive.length > 0 ? behind / (alive.length + 1 - 1) : 0; // 0=首位..1=最下位（自分含む生存者中）
    const dis = Math.min(1, 0.5 * pinch + 0.5 * rankBehind);
    const k = comebackRef.current; // 逆転補正の強さ（0=なし）
    const bias = (dis - 0.5) * 2; // -1（優勢）..+1（劣勢）
    const defBoost = 1 + Math.max(0, bias) * k;
    const atkBoost = 1 + Math.max(0, -bias) * k;
    const weighted: { item: ItemType; w: number }[] = [];
    for (const it of ALL_ITEMS) {
      if (it === 'gaugedown' && gaugeDownObtainedRef.current) continue; // 一人一個まで
      if (it === 'maxhp' && hpUpCountRef.current >= MAX_HP_UP) continue; // 上限に達したら出さない
      const kind = ITEM_KIND[it];
      // 劣勢ほど防御/逆転、優勢ほど攻撃が出やすい。util はフラット。
      let w = kind === 'def' ? defBoost : kind === 'atk' ? atkBoost : 1;
      w *= ITEM_RARITY[it] ?? 1; // レアリティ係数（トーテム/大掃除などの強力アイテムを抑える）
      weighted.push({ item: it, w });
    }
    const total = weighted.reduce((s, x) => s + x.w, 0);
    let acc = r * total;
    let pick: ItemType = weighted[0].item;
    for (const x of weighted) {
      acc -= x.w;
      if (acc <= 0) { pick = x.item; break; }
    }
    if (pick === 'gaugedown') gaugeDownObtainedRef.current = true; // 以降は出さない
    sfx.item();
    setItemFlash(true);
    setTimeout(() => setItemFlash(false), 1000);
    // 使い方設定に従ってスロットへ格納/発動する。
    const cat = ITEM_CAT[pick];
    const mode: UseMode = autoFullRef.current ? 'auto' : useModeRef.current[cat];
    const existing = slotsRef.current[cat];
    if (mode === 'instant') {
      sfx.use();
      applyItem(pick); // 拾った瞬間に発動（保持しない）
    } else if (mode === 'usenew') {
      if (existing) { sfx.use(); applyItem(pick); } // 既存を保持し、新着を発動
      else setSlot(cat, pick);
    } else {
      // hold / auto: スロットが埋まっていたら古い方を自動発動し、新着を保持。
      if (existing) applyItem(existing);
      setSlot(cat, pick);
    }
  }, [applyItem, setSlot]);

  // オート発動: スロット別に「オート」設定（または完全オート）のアイテムを良い時に自動発動。
  useEffect(() => {
    if (gameState !== 'playing') return;
    const id = setInterval(() => {
      const frac = stateRef.current.backlog.length / maxBacklogRef.current; // 不利度
      const incoming = pendingRef.current.reduce((s, e) => s + e.amount, 0);
      for (const cat of CAT_ORDER) {
        const item = slotsRef.current[cat];
        if (!item) continue;
        const mode: UseMode = autoFullRef.current ? 'auto' : useModeRef.current[cat];
        if (mode !== 'auto') continue;
        let use = false;
        if (cat === 'defense') use = frac >= 0.55 || incoming >= 3;
        else if (cat === 'attack') use = frac <= 0.5 && stateRef.current.combo >= 2;
        else use = frac >= 0.45 || incoming >= 2;
        if (frac >= 0.8) use = true; // 死にそうなら何でも発動
        if (use) {
          sfx.use();
          applyItem(item);
          setSlot(cat, null);
        }
      }
    }, 700);
    return () => clearInterval(id);
  }, [gameState, applyItem, setSlot]);

  // 指定スロットのアイテムを発動。
  const fireSlot = useCallback((cat: ItemCat) => {
    const item = slotsRef.current[cat];
    if (!item) return;
    sfx.use();
    applyItem(item);
    setSlot(cat, null);
  }, [applyItem, setSlot]);
  // 選択中スロットを発動（cycle方式の発動キー）。
  const fireSelected = useCallback(() => { fireSlot(selectedSlotRef.current); }, [fireSlot]);
  // 選択スロットを切り替え（cycle方式の切替キー）。
  const cycleSlot = useCallback(() => {
    setSelectedSlot((c) => CAT_ORDER[(CAT_ORDER.indexOf(c) + 1) % CAT_ORDER.length]);
  }, []);

  const cycleTargetMode = useCallback(() => {
    setTargetMode((m) => {
      const idx = TARGET_MODES.findIndex((t) => t.mode === m);
      return TARGET_MODES[(idx + 1) % TARGET_MODES.length].mode;
    });
  }, []);

  const startGame = useCallback(() => {
    setExtraWords(loadCustomWords()); // 端末の追加語句を出題プールへ（オンラインで上書きされていても戻す）
    const newSeed = randomSeed();
    const wordRng = mulberry32(newSeed);
    const itemRng = mulberry32((newSeed ^ 0x9e3779b9) >>> 0);
    wordRngRef.current = wordRng;
    itemRngRef.current = itemRng;
    shieldRef.current = false;
    brakeUntilRef.current = 0;
    lastAttackerRef.current = null;
    updatePending([]);
    setSeed(newSeed);
    bagRef.current = newWordBag(); // 出題バッグを新しい1巡でリセット
    treasureBoostRef.current = 0;
    hpUpCountRef.current = 0;
    setBacklog([nextWord(), nextWord(), nextWord()]);
    setTokenIndex(0);
    setCurrentTyping('');
    setTypedRomaji([]);
    setCombo(0);
    setMaxCombo(0);
    setScore(0);
    setKeysTyped(0);
    setMissCount(0);
    setPlayerKOs(0);
    setSelfLog([]);
    setToasts([]);
    setSlots({ attack: null, defense: null, timed: null });
    setSelectedSlot('attack');
    slotsRef.current = { attack: null, defense: null, timed: null };
    setStartTime(Date.now());
    setEndTime(null);
    // カスタム設定を反映（HP＝積載限界、敵数、CPUの強さ）。
    maxBacklogRef.current = cfgHp;
    setMaxBacklog(cfgHp);
    setDummyCount(cfgEnemies);
    cpuStrengthRef.current = cfgCpuStr / 10;
    accelRef.current = cfgAccel;
    minRef.current = cfgMin;
    rapidUntilRef.current = 0;
    keepUntilRef.current = 0;
    parryUntilRef.current = 0;
    totemUntilRef.current = 0;
    freezeUntilRef.current = 0;
    barrierRef.current = false;
    guardCountRef.current = 0;
    attackThresholdRef.current = cfgAttackGauge;
    setAttackThreshold(cfgAttackGauge);
    gaugeDownObtainedRef.current = false;
    attackProgressRef.current = 0;
    setAttackProgress(0);
    setSpawnInterval(cfgInitial);
    setGameState('playing');
    // 敵数ぶんのダミーを作り直す。各CPUは目標強さの周りにばらつかせた個別の str を持つ
    // （＝強いCPU・弱いCPUが混在し、平均が設定値になる。個体ごとに独立した挙動の元）。
    const target = cfgCpuStr / 10;
    setDummies(
      Array.from({ length: cfgEnemies }).map((_, i) => {
        const str = Math.min(1, Math.max(0, target + (Math.random() - 0.5) * 0.7));
        return {
          id: i, height: Math.floor(Math.random() * 5), isKO: false, name: cpuName(i), combo: 0, atk: 0, str,
        };
      }),
    );
    sfx.start();
  }, [cfgInitial, cfgMin, cfgAccel, cfgHp, cfgEnemies, cfgCpuStr, cfgAttackGauge, updatePending, nextWord]);

  const gameOver = useCallback(() => {
    setGameState('gameover');
    setEndTime(Date.now()); // KPM をこの時点で固定
    sfx.gameover();
    setShake(true);
    setTimeout(() => setShake(false), 450);
  }, []);

  // --- 入力処理 ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (settingsOpenRef.current) return; // 設定モーダル表示中はゲーム操作を受け付けない
      const { gameState } = stateRef.current;
      resumeAudio();
      if ((gameState === 'start' || gameState === 'gameover' || gameState === 'win') && e.key === ' ') {
        e.preventDefault();
        startGame();
        return;
      }
      // プレイ中: キーコンフィグ(code)に従ってアイテム操作・ターゲット切替。
      if (gameState === 'playing') {
        const kc = keyConfigRef.current;
        if (e.code === kc.target) { e.preventDefault(); cycleTargetMode(); return; }
        if (kc.inputMode === 'cycle') {
          if (e.code === kc.cycle) { e.preventDefault(); cycleSlot(); return; }
          if (e.code === kc.fire) { e.preventDefault(); fireSelected(); return; }
        } else {
          // 直接キー式: 各スロットのキーで即発動。
          let handled = false;
          for (const cat of CAT_ORDER) {
            if (e.code === kc.slots[cat]) { e.preventDefault(); fireSlot(cat); handled = true; break; }
          }
          if (handled) return;
        }
      }
      if (gameState !== 'playing' || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      const key = e.key.toLowerCase();
      const result = processKey(key, stateRef.current);

      if (result.miss) {
        // 連鎖キープ中はミスしても連鎖（＝アタック数）を維持する。
        if (Date.now() >= keepUntilRef.current) setCombo(0);
        setMissCount((m) => m + 1);
        setMissFlash(true);
        setRomajiHint(true); // ミスしたらこのワードはローマ字を表示（次のワードで消える）
        sfx.miss();
        setTimeout(() => setMissFlash(false), 150);
      } else if (result.wordCleared && result.nextState) {
        const newCombo = result.nextState.combo;
        setBacklog(result.nextState.backlog);
        setTokenIndex(0);
        setCurrentTyping('');
        setTypedRomaji([]); // 次のワードへ：実打綴りをリセット
        setRomajiHint(false); // 次のワードへ：ローマ字ヒントを消す
        setCombo(newCombo);
        setMaxCombo((m) => Math.max(m, newCombo));
        setKeysTyped((prev) => prev + 1);
        setScore((s) => s + 100 + newCombo * 10);
        sfx.clear();
        // 1単語クリアごとに、来ている着弾予告を1つ相殺（タイピング＝防御）。
        offsetIncoming(1);
        // ゲージはミスでは減らない。加算方式は「ワード数」=1 /「文字数」=クリアした語の読み文字数。
        // しきい値に達するごとに発射。攻撃量は連鎖（とバッジ）に応じる（相殺は1ワード=1のまま）。
        const clearedWord = stateRef.current.backlog[0];
        const charMode = gaugeModeRef.current === 'char';
        const inc = charMode ? (clearedWord?.reading.length || 1) : 1;
        const gaugeThr = charMode ? gaugeCharsRef.current : attackThresholdRef.current;
        attackProgressRef.current += inc;
        while (attackProgressRef.current >= gaugeThr) {
          attackProgressRef.current -= gaugeThr;
          // 連鎖で攻撃量UP → バッジ（撃破数）でさらに上昇（上限/上昇率はカスタム設定）。
          let amt = 1 + Math.floor(newCombo / comboStepRef.current);
          const badges = Math.min(playerKOsRef.current, badgeCapRef.current);
          amt = Math.round(amt * (1 + (badgeRateRef.current / 100) * badges));
          fireAttack(Math.min(amt, attackCapRef.current));
        }
        setAttackProgress(attackProgressRef.current);
        if (Date.now() < rapidUntilRef.current) fireAttack(1); // 連射: 1クリアごとに1攻撃
        if (result.clearedType === 'treasure') grantItem();
      } else if (result.nextState) {
        setTokenIndex(result.nextState.tokenIndex);
        setCurrentTyping(result.nextState.currentTyping);
        if (result.typed) setTypedRomaji((tr) => { const n = [...tr]; for (const x of result.typed!) n[x.index] = x.romaji; return n; });
        setKeysTyped((prev) => prev + 1);
        sfx.type();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [startGame, fireSelected, cycleSlot, fireSlot, fireAttack, grantItem, cycleTargetMode, offsetIncoming]);

  // --- CPUの挙動: 自滅ランダムウォーク + プレイヤーへの攻撃 + アイテム使用 ---
  useEffect(() => {
    if (gameState !== 'playing') return;
    const interval = setInterval(() => {
      // 盤面の上下動。CPUごとの強さ(str)で「処理が速い＝下がりやすい」を表現する。
      // 強いCPUほど height が下がりやすく（生き残る）、弱いCPUは溜まって自滅しやすい。
      setDummies((prev) =>
        prev.map((d) => {
          if (d.isKO) return d;
          const s = d.str ?? 0.5;
          const downProb = 0.4 + s * 0.45; // 強いほど下がる（クリアする）確率が高い
          let newHeight = d.height + (Math.random() < downProb ? -1 : 1);
          if (newHeight < 0) newHeight = 0;
          let combo = d.combo ?? 0;
          combo = Math.random() < 0.4 + s * 0.4 ? combo + 1 : 0; // 強いほど連鎖が伸びやすい
          if (newHeight > maxBacklogRef.current) {
            sfx.eliminate();
            return { ...d, height: 0, isKO: true, combo: 0 };
          }
          return { ...d, height: newHeight, combo };
        }),
      );

      const alive = dummiesRef.current.filter((d) => !d.isKO);
      if (alive.length === 0) return;
      const target = cpuStrengthRef.current; // 0..1 目標強さ

      // 一部のCPUがプレイヤーを攻撃（着弾予告ゲージに追加）。
      // 攻撃頻度は全体の強さ設定に比例。攻撃者は強いCPUほど選ばれやすい（個体差）。
      const incomingNow = pendingRef.current.reduce((s, e) => s + e.amount, 0);
      const attackChance = 0.1 + target * 0.3;
      const frozen = Date.now() < freezeUntilRef.current; // フリーズ中は被攻撃を無効化
      if (!frozen && incomingNow < 4 && Math.random() < attackChance) {
        // str を重みにして攻撃者を選ぶ（強いCPUが主な脅威になる）。
        const totW = alive.reduce((sum, d) => sum + 0.2 + (d.str ?? 0.5), 0);
        let acc = Math.random() * totW;
        let attacker = alive[0];
        for (const d of alive) { acc -= 0.2 + (d.str ?? 0.5); if (acc <= 0) { attacker = d; break; } }
        const amount = Math.random() < 0.5 + (attacker.str ?? 0.5) * 0.4 ? (Math.random() < 0.6 ? 2 : 1) : 1;
        lastAttackerRef.current = attacker.id;
        setDummies((prev) => prev.map((d) => (d.id === attacker.id ? { ...d, atk: (d.atk ?? 0) + 1 } : d)));
        updatePending([
          ...pendingRef.current,
          { id: telegraphIdRef.current++, amount, confirmAt: Date.now() + TELEGRAPH_DELAY },
        ]);
        fireIncoming(attacker.id);
        pushToast(`${attacker.name} から攻撃 +${amount}`, 'in');
      }

      // 一部のCPUがアイテムを使用。多くは演出のみ（ミニボードに絵文字）だが、
      // ロング送信を引いた時は実際にプレイヤーへ長文（ことわざ）を送りつける。
      // アイテムOFFのときはCPUもアイテムを使わない。
      if (itemsOnRef.current && Math.random() < 0.15) {
        const user = alive[Math.floor(Math.random() * alive.length)];
        const item = ALL_ITEMS[Math.floor(Math.random() * ALL_ITEMS.length)];
        setDummies((prev) => prev.map((d) => (d.id === user.id ? { ...d, lastItem: item, itemAt: Date.now() } : d)));
        const incomingNew = pendingRef.current.reduce((s, e) => s + e.amount, 0);
        // 既に山または着弾予告に長文がある相手には、新たな長文を送らない（重ねがけ防止）。
        const alreadyHasLong =
          pendingRef.current.some((e) => !!e.word) ||
          stateRef.current.backlog.some((w) => w.type === 'ojama' && w.reading.length >= 10);
        if (item === 'longbomb' && !alreadyHasLong && incomingNew < 6 && Date.now() >= freezeUntilRef.current) {
          const lw = randomLongWord();
          lastAttackerRef.current = user.id;
          setDummies((prev) => prev.map((d) => (d.id === user.id ? { ...d, atk: (d.atk ?? 0) + 1 } : d)));
          updatePending([
            ...pendingRef.current,
            { id: telegraphIdRef.current++, amount: 1, confirmAt: Date.now() + TELEGRAPH_DELAY, word: lw },
          ]);
          fireIncoming(user.id);
          pushToast(`${user.name} から長文 📨`, 'in');
        } else {
          pushToast(`${user.name} が ${ITEM_META[item].name} 使用`, 'item');
        }
      }

      // テトリス99のように、CPU同士も撃ち合う（自分以外の攻防を可視化）。
      if (alive.length >= 2 && Math.random() < 0.6) {
        const a = alive[Math.floor(Math.random() * alive.length)];
        let b = alive[Math.floor(Math.random() * alive.length)];
        if (b.id === a.id) b = alive[(alive.indexOf(a) + 1) % alive.length];
        if (b.id !== a.id) {
          const willKO = b.height + 1 > maxBacklogRef.current;
          setDummies((prev) =>
            prev.map((d) =>
              d.id === b.id ? (willKO ? { ...d, height: 0, isKO: true, combo: 0 } : { ...d, height: d.height + 1 }) : d,
            ),
          );
          if (willKO) sfx.eliminate();
          const from = dummyRefs.current[a.id]?.getBoundingClientRect();
          const to = dummyRefs.current[b.id]?.getBoundingClientRect();
          if (from && to) {
            addBeam(
              from.left + from.width / 2, from.top + from.height / 2,
              to.left + to.width / 2, to.top + to.height / 2,
              '#94a3b8', // CPU同士は中立的なグレーで自分の攻撃(オレンジ)と区別
            );
          }
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [gameState, fireIncoming, pushToast, updatePending, addBeam]);

  // --- 受信予告の確定処理（時間が来たらおじゃまをバックログへ） ---
  useEffect(() => {
    if (gameState !== 'playing') return;
    const id = setInterval(() => {
      if (pendingRef.current.length === 0) return;
      const now = Date.now();
      if (now < freezeUntilRef.current) return; // フリーズ中は確定を保留
      const due = pendingRef.current.filter((e) => e.confirmAt <= now);
      if (due.length === 0) return;
      updatePending(pendingRef.current.filter((e) => e.confirmAt > now));
      // 受け流し中は、確定したおじゃまを自分に入れずランダムな敵CPUへ逸らす。
      if (now < parryUntilRef.current) {
        let deflect = 0;
        for (const e of due) deflect += e.word ? 2 : e.amount;
        if (deflect > 0) {
          deflectToCpu(deflect);
          pushToast(`受け流し！ +${deflect}`, 'item');
          sfx.parry();
          setParryFx(true);
          setTimeout(() => setParryFx(false), 500);
        }
        return;
      }
      // バリア中は、今回の被弾をまるごと1回防ぐ。
      if (barrierRef.current) {
        barrierRef.current = false;
        pushToast('バリアで防御！', 'item');
        sfx.use();
        return;
      }
      const words: Word[] = [];
      for (const e of due) {
        if (e.word) words.push(makeOjamaWordFrom(e.word.display, e.word.reading));
        else for (let i = 0; i < e.amount; i++) words.push(makeOjamaWord(themeRef.current));
      }
      if (words.length === 0) return;
      sfx.damage(); // 被弾SE（おじゃまが実際にバックログへ入った瞬間）
      setBacklog((prev) => {
        const next = [...prev, ...words];
        if (next.length >= maxBacklogRef.current) {
          if (overflowProtect() === 'protected') return next.slice(0, maxBacklogRef.current - 1);
          gameOver();
          return next.slice(0, maxBacklogRef.current);
        }
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [gameState, gameOver, updatePending, deflectToCpu, pushToast, overflowProtect]);

  // 全CPUを倒したら勝利（ソロの勝利条件）。
  useEffect(() => {
    if (gameState !== 'playing') return;
    if (dummies.length > 0 && dummies.every((d) => d.isKO)) {
      setGameState('win');
      setEndTime(Date.now()); // KPM をこの時点で固定
      sfx.start();
    }
  }, [dummies, gameState]);

  // --- ベース供給＆加速ループ ---
  useEffect(() => {
    if (gameState !== 'playing') return;
    let timerId: ReturnType<typeof setTimeout>;
    const loop = () => {
      const now = Date.now();
      if (now < brakeUntilRef.current || now < freezeUntilRef.current) {
        // ブレーキ / フリーズ中は供給停止
      } else if (guardCountRef.current > 0) {
        guardCountRef.current -= 1; // ガード: 複数回ぶん供給を無効化
      } else if (shieldRef.current) {
        shieldRef.current = false;
      } else {
        setBacklog((prev) => {
          if (prev.length >= maxBacklogRef.current) {
            if (overflowProtect() === 'protected') return prev.slice(0, maxBacklogRef.current - 1);
            gameOver();
            return prev;
          }
          return wordRngRef.current ? [...prev, nextWord()] : prev;
        });
      }
      setSpawnInterval((prev) => Math.max(minRef.current, prev * accelRef.current));
      timerId = setTimeout(loop, spawnInterval);
    };
    timerId = setTimeout(loop, spawnInterval);
    return () => clearTimeout(timerId);
  }, [gameState, spawnInterval, gameOver, overflowProtect, nextWord]);

  // --- カウントダウン描画用の時刻ティック ---
  useEffect(() => {
    if (gameState !== 'playing') return;
    const id = setInterval(() => setNowTick(Date.now()), 150);
    return () => clearInterval(id);
  }, [gameState]);

  const calculateKPM = () => {
    if (!startTime || keysTyped === 0) return 0;
    // ゲーム終了後は終了時刻で固定（裏で時間が進んで KPM が下がるのを防ぐ）。
    const end = endTime ?? Date.now();
    const minutes = Math.max(1 / 600, (end - startTime) / 60000); // 0除算回避
    return Math.floor(keysTyped / minutes);
  };

  const renderCurrentWord = () => {
    if (backlog.length === 0) return null;
    const word = backlog[0];
    const isOjama = word.type === 'ojama';
    const isTreasure = word.type === 'treasure';
    return (
      <div
        className={`w-full p-6 rounded-xl border-2 shadow-2xl mb-4 transition-all duration-200 ${
          isOjama
            ? 'border-red-500/50 bg-red-950/30'
            : isTreasure
              ? 'border-yellow-400/50 bg-yellow-900/30 shadow-yellow-500/20'
              : 'border-blue-500/30 bg-gray-800/80'
        }`}
      >
        <CurrentWord
          word={word}
          tokenIndex={tokenIndex}
          currentTyping={currentTyping}
          accent={isOjama ? 'text-red-400' : isTreasure ? 'text-yellow-400' : 'text-cyan-400'}
          typedRomaji={typedRomaji}
          romajiVisible={keyCfg.romajiMode === 'always' || romajiHint}
        />
      </div>
    );
  };

  // 加速度（表示用）: 大きいほど速く加速。内部の供給間隔倍率(cfgAccel)は
  // 1.00=加速なし、0.90=最速。speed = (1 - 倍率) * 100 で 0〜10 にマップ。
  const accelSpeed = Math.round((1 - cfgAccel) * 1000) / 10;
  const setAccelFromSpeed = (s: number) => {
    const clamped = Math.min(10, Math.max(0, s));
    setCfgAccel(Math.round((1 - clamped / 100) * 1000) / 1000);
  };

  const isDanger = backlog.length >= maxBacklog - 3;
  const eliminatedCount = dummies.filter((d) => d.isKO).length;
  const survivors = dummyCount + 1 - eliminatedCount;
  const totalIncoming = pending.reduce((s, e) => s + e.amount, 0);

  // 発動中の時間制限アイテム（残り時間カウントダウン表示用）。
  const activeEffects: { type: ItemType; until: number; color: string }[] = (
    [
      { type: 'brake', until: brakeUntilRef.current, color: 'bg-green-500' },
      { type: 'rapid', until: rapidUntilRef.current, color: 'bg-yellow-400' },
      { type: 'keep', until: keepUntilRef.current, color: 'bg-fuchsia-500' },
      { type: 'parry', until: parryUntilRef.current, color: 'bg-violet-500' },
      { type: 'totem', until: totemUntilRef.current, color: 'bg-amber-400' },
      { type: 'freeze', until: freezeUntilRef.current, color: 'bg-sky-400' },
    ] as { type: ItemType; until: number; color: string }[]
  ).filter((e) => nowTick > 0 && e.until > nowTick);

  return (
    <div className={`h-screen bg-transparent text-white font-sans overflow-hidden flex flex-col selection:bg-cyan-900 ${shake ? 'screen-shake' : ''}`}>
      <div className={`fixed inset-0 pointer-events-none z-50 transition-colors duration-100 ${missFlash ? 'bg-red-500/20' : 'bg-transparent'}`} />
      {/* 被弾時の赤フラッシュ */}
      <div
        className={`fixed inset-0 pointer-events-none z-40 transition-opacity duration-150 ${damageFlash ? 'opacity-100' : 'opacity-0'}`}
        style={{ boxShadow: 'inset 0 0 140px 40px rgba(239,68,68,0.55)' }}
      />

      {/* 受け流し成功エフェクト（シアンの衝撃波リング＋PARRY!） */}
      {parryFx && (
        <div className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center">
          <div className="parry-ring rounded-full border-4 border-cyan-300" />
          <div className="absolute parry-label text-4xl font-black italic text-cyan-200 drop-shadow-[0_0_18px_rgba(34,211,238,0.9)]">
            PARRY!
          </div>
        </div>
      )}

      {/* 不死のトーテム発動中エフェクト（金色のオーラ＋舞い上がる粒子） */}
      {gameState === 'playing' && nowTick < totemUntilRef.current && (
        <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden totem-aura">
          <div className="absolute inset-0" style={{ boxShadow: 'inset 0 0 160px 50px rgba(250,204,21,0.45)' }} />
          {Array.from({ length: 14 }).map((_, i) => (
            <span
              key={i}
              className="totem-particle absolute text-yellow-300/90"
              style={{ left: `${(i * 7 + 5) % 100}%`, animationDelay: `${(i % 7) * 0.22}s`, fontSize: `${10 + (i % 4) * 4}px` }}
            >
              ✦
            </span>
          ))}
          <div className="absolute top-20 left-1/2 -translate-x-1/2 text-5xl opacity-40 totem-emblem">🗿</div>
        </div>
      )}

      {/* 攻撃/被弾ビーム（発光ライン＋白コア＋飛んでいく弾＋着弾リング） */}
      {beams.length > 0 && (
        <svg className="fixed inset-0 w-full h-full pointer-events-none z-40">
          <defs>
            <filter id="beamGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {beams.map((b) => (
            <g key={b.id} className="attack-beam" filter="url(#beamGlow)">
              <line x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} stroke={b.color} strokeWidth={5} strokeLinecap="round" opacity={0.85} />
              <line x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} stroke="#fff" strokeWidth={1.5} strokeLinecap="round" opacity={0.7} />
              <circle cx={b.x2} cy={b.y2} r={16} fill="none" stroke={b.color} strokeWidth={3} />
              <circle r={7} fill="#fff">
                <animate attributeName="cx" from={b.x1} to={b.x2} dur="0.28s" fill="freeze" />
                <animate attributeName="cy" from={b.y1} to={b.y2} dur="0.28s" fill="freeze" />
              </circle>
            </g>
          ))}
        </svg>
      )}

      {/* アイテム発動演出（名前＋ざっくり効果説明） */}
      {useFlash && (
        <div className="fixed top-[8rem] left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in zoom-in duration-200 flex flex-col items-center gap-1">
          <div className="bg-yellow-500/95 text-black font-black px-4 py-1.5 rounded-full flex items-center gap-2 shadow-lg">
            <span className="text-lg">{ITEM_META[useFlash].icon}</span> {ITEM_META[useFlash].name} 発動！
          </div>
          <div className="bg-black/80 text-gray-100 text-xs px-3 py-1 rounded-full shadow">{ITEM_META[useFlash].desc}</div>
        </div>
      )}

      {/* 盤面変化系アイテムの強調演出（画面フラッシュ＋中央バナー）。古い単語を打ち続けないように。 */}
      {boardFx && (
        <>
          <div className="fixed inset-0 pointer-events-none z-40 board-fx-flash" style={{ boxShadow: 'inset 0 0 160px 50px rgba(217,70,239,0.45)' }} />
          <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center pointer-events-none">
            <div className="board-fx-banner bg-fuchsia-600/95 text-white font-black text-xl px-6 py-2.5 rounded-2xl shadow-2xl flex items-center gap-3 border-2 border-white/50">
              <span className="text-2xl">{ITEM_META[boardFx].icon}</span>
              盤面が変化！ <span className="text-fuchsia-100">{ITEM_META[boardFx].name}</span>
            </div>
          </div>
        </>
      )}

      {/* 演出は上部に出して、打つべき単語に被らないようにする */}
      {attackFlash && (
        <div className="fixed top-[4.5rem] left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="text-3xl font-black italic text-orange-400 drop-shadow-[0_0_15px_rgba(251,146,60,0.8)] flex items-center gap-2">
            {attackFlash.amount > 0 ? (
              <>
                <Swords className="w-7 h-7" /> ATTACK ×{attackFlash.amount}!
                {attackFlash.name && <span className="text-base text-orange-200 not-italic">→ {attackFlash.name}</span>}
              </>
            ) : (
              <span className="text-cyan-300">相殺！</span>
            )}
          </div>
        </div>
      )}

      {itemFlash && (
        <div className="fixed top-[4.5rem] left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="text-3xl font-black text-yellow-300 drop-shadow-[0_0_20px_rgba(250,204,21,0.8)] flex items-center gap-3">
            <Sparkles className="w-8 h-8" /> ITEM GET! <Sparkles className="w-8 h-8" />
          </div>
        </div>
      )}

      <header className="h-16 border-b border-white/10 flex items-center justify-between px-8 bg-neutral-900/50 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <button onClick={onExit} className="text-gray-500 hover:text-gray-300">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Swords className="text-cyan-400" />
          <h1 className="text-xl font-bold tracking-widest text-gray-200">
            TYPE ROYALE<span className="text-xs ml-2 text-gray-500">SOLO</span>
          </h1>
        </div>
        <div className="flex gap-6 md:gap-8">
          <Hud label="SCORE" value={score} className="text-cyan-300" />
          <Hud label="KPM" value={calculateKPM()} />
          <Hud label="K.O." value={playerKOs} icon={<Trophy className="w-4 h-4 text-yellow-500" />} />
          <Hud label="BADGE" value={Math.min(playerKOs, 4)} icon={<Shield className="w-4 h-4 text-blue-400" />} />
          <button
            onClick={() => {
              const next = !muted;
              setMuted(next);
              setSfxEnabled(!next);
            }}
            className="text-gray-500 hover:text-gray-300 self-center"
            title={muted ? '効果音オン' : '効果音オフ'}
          >
            {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="text-gray-500 hover:text-gray-300 self-center"
            title="プレイヤー設定（キー設定）"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex w-full px-3 py-4 gap-3 h-[calc(100vh-4rem)]">
        <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2 content-start">
          {dummies.slice(0, Math.ceil(dummies.length / 2)).map((d) => (
            <div key={d.id} ref={(el) => { dummyRefs.current[d.id] = el; }}>
              <MiniBoard
                height={d.height}
                max={maxBacklog}
                isKO={d.isKO}
                name={d.name}
                combo={d.combo}
                hit={hitDummy === d.id}
                incoming={incomingDummy === d.id}
                itemEmoji={d.itemAt && Date.now() - d.itemAt < 1500 ? ITEM_EMOJI[d.lastItem as ItemType] : undefined}
                str={d.str}
              />
            </div>
          ))}
        </div>

        <div ref={centerRef} className="w-2/4 flex flex-col h-full min-h-0 relative">
          {isDanger && gameState === 'playing' && (
            <div className="absolute inset-0 border-4 border-red-500/50 rounded-2xl pointer-events-none animate-pulse z-0" />
          )}

          <div className="flex-1 min-h-0 flex flex-col items-center pt-4 relative z-10">
            {gameState === 'playing' && (
              <div className="absolute top-2 right-0 text-right">
                <div className="text-xs text-gray-500">ALIVE</div>
                <div className="font-mono text-2xl font-bold text-gray-300">
                  {survivors}
                  <span className="text-sm text-gray-600"> / {dummyCount + 1}</span>
                </div>
              </div>
            )}

            {/* ログ（ALIVEの下・入力の右側の空白を使用）。上＝アイテム使用 / 下＝攻撃・撃破 */}
            {gameState === 'playing' && (
              <div className="absolute top-16 right-0 w-40 z-20 flex flex-col gap-2 pointer-events-none">
                <div>
                  <div className="text-[9px] font-bold text-yellow-300/80 mb-0.5 text-right">アイテム使用</div>
                  <div className="flex flex-col gap-0.5 items-end">
                    {toasts.filter((t) => t.kind === 'item').slice(-5).map((t) => (
                      <div key={t.id} className="max-w-full truncate px-2 py-0.5 rounded bg-yellow-600/80 text-black text-[10px] font-bold shadow animate-in fade-in slide-in-from-right-2 duration-200">
                        ✨ {t.text}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] font-bold text-orange-300/80 mb-0.5 text-right">攻撃・撃破</div>
                  <div className="flex flex-col gap-0.5 items-end">
                    {toasts.filter((t) => t.kind === 'ko' || t.kind === 'in').slice(-6).map((t) => (
                      <div key={t.id} className={`max-w-full truncate px-2 py-0.5 rounded text-[10px] font-bold shadow animate-in fade-in slide-in-from-right-2 duration-200 ${
                        t.kind === 'ko' ? 'bg-orange-600/85 text-white' : 'bg-red-950/85 text-red-200 border border-red-500/40'
                      }`}>
                        {t.kind === 'ko' ? '🏆 ' : '⚠ '}{t.text}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] font-bold text-cyan-300/80 mb-0.5 text-right">自分のアイテム</div>
                  <div className="flex flex-col gap-0.5 items-end">
                    {selfLog.slice(-5).map((l) => (
                      <div key={l.id} className="max-w-full px-2 py-0.5 rounded bg-cyan-900/85 text-cyan-100 text-[10px] font-bold shadow border border-cyan-500/40 animate-in fade-in slide-in-from-right-2 duration-200">
                        <div className="flex items-center gap-1">{ITEM_META[l.item].icon} {ITEM_META[l.item].name}</div>
                        <div className="text-[9px] font-normal text-cyan-200/80 leading-tight">{ITEM_META[l.item].desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ターゲットモード切替（[Tab]でも切替） */}
            {gameState === 'playing' && (
              <div className="absolute top-1 left-0 flex flex-col items-start gap-1">
                <div className="flex items-center gap-1 text-[10px] text-gray-500"><Target className="w-3 h-3" /> 狙い [{keyLabel(keyCfg.target)}]</div>
                <div className="flex gap-1">
                  {TARGET_MODES.map((t) => (
                    <button
                      key={t.mode}
                      onClick={() => setTargetMode(t.mode)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                        targetMode === t.mode ? 'bg-cyan-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}


            <div className="shrink-0 mb-3 text-center h-16 flex items-end justify-center">
              {combo > 2 && (
                <div className="animate-in slide-in-from-bottom-4 text-3xl font-black italic text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.6)] flex items-center gap-2">
                  <Zap className="w-8 h-8 fill-cyan-400" /> {combo} COMBO!
                </div>
              )}
            </div>

            {/* お題を画面中央付近に置くための上スペーサー（固定） */}
            {/* お題エリア（固定高さ）。お題の有無・長短や効果ゲージ増減でレイアウトが動かない。 */}
            <div className="shrink-0 h-2" />

            {/* 次のお題プレビュー（固定高さ）。直近の次のお題を常にお題カード直上（下端）に表示。 */}
            <div className="shrink-0 w-full max-w-lg h-14 flex flex-col justify-end gap-1 overflow-hidden mb-2">
              {backlog
                .slice(1, 3)
                .reverse()
                .map((word) => (
                  <div
                    key={word.id}
                    className={`px-4 py-1.5 rounded-lg text-sm font-bold opacity-80 flex justify-between items-center ${
                      word.type === 'ojama'
                        ? 'bg-red-950/50 text-red-300 border border-red-900/50'
                        : word.type === 'treasure'
                          ? 'bg-yellow-900/30 text-yellow-300 border border-yellow-700/50'
                          : 'bg-blue-950/40 text-blue-200 border border-blue-900/50'
                    }`}
                  >
                    <span>{word.display}</span>
                    {word.type === 'ojama' && <AlertTriangle className="w-4 h-4" />}
                    {word.type === 'treasure' && <Sparkles className="w-4 h-4" />}
                  </div>
                ))}
            </div>

            {/* お題カード（固定高さ・中央寄せ）。プレビューと同じ max-w-lg 中央寄せで横位置を揃える。
                着弾予告ゲージはカードの左隣に絶対配置し、カードの中央位置に影響させない。 */}
            <div className="shrink-0 w-full max-w-lg relative">
              {gameState === 'playing' && (
                <div className="absolute right-full top-1/2 -translate-y-1/2 mr-2 w-12 flex flex-col items-center gap-1 pointer-events-none">
                  <div className={`text-sm font-bold text-red-400 mb-0.5 h-5 ${totalIncoming > 0 ? 'animate-pulse' : ''}`}>{totalIncoming > 0 ? `⚠ ${totalIncoming}` : ''}</div>
                  <div className="w-6 flex flex-col-reverse gap-[3px]">
                    {Array.from({ length: Math.min(maxBacklog, 12) }).map((_, i) => {
                      const filled = i < Math.min(totalIncoming, 12);
                      return (
                        <div key={i} className={`w-full h-[13px] rounded ${filled ? 'bg-red-500 border border-red-300/50 shadow-[0_0_7px_rgba(239,68,68,0.65)]' : 'bg-neutral-800/50 border border-neutral-700/40'}`} />
                      );
                    })}
                  </div>
                  <div className="text-[10px] text-gray-400 text-center leading-tight mt-0.5">おじゃま<br />着弾予告</div>
                </div>
              )}

              {/* お題カードの固定高さスロット（中央寄せ）。お題の有無や行数が変わっても高さ一定。 */}
              <div className="h-52 flex items-center justify-center">
                {renderCurrentWord()}
              </div>
            </div>

            {/* グループ3: アイテムスロット〜アタックゲージ（画面下部に固定）。
                高さは常に一定なので、効果ゲージが何個出ても上のお題グループは動かない。 */}
            <div className="shrink-0 w-full flex flex-col items-center">
              {/* アイテムスロット（攻撃/防御/妨害）。入力方式に応じて選択強調 or 割当キーを表示。
                  アイテムOFFのときはスロットを表示しない。 */}
              {gameState === 'playing' && cfgItemsOn && (
                <div className="flex flex-col items-center gap-1">
                  <div className="flex justify-center gap-2">
                    {CAT_META.map((c) => {
                      const item = slots[c.key];
                      const direct = keyCfg.inputMode === 'direct';
                      const sel = !direct && selectedSlot === c.key;
                      return (
                        <button
                          key={c.key}
                          onClick={() => (direct ? fireSlot(c.key) : setSelectedSlot(c.key))}
                          className={`min-w-[5.5rem] rounded-lg border px-2 py-1 flex flex-col items-center transition-colors ${
                            sel ? 'border-cyan-400 bg-cyan-950/40 shadow-[0_0_8px_rgba(34,211,238,0.4)]' : 'border-white/10 bg-neutral-900/80'
                          }`}
                        >
                          <span className={`text-[9px] font-bold ${c.color}`}>
                            {c.label}
                            {direct && <span className="ml-1 text-gray-400 font-mono">[{keyLabel(keyCfg.slots[c.key])}]</span>}
                          </span>
                          {item ? (
                            <span className="flex items-center gap-1">
                              <ItemIcon type={item} />
                              <span className="text-[10px] font-bold text-yellow-200">{ITEM_META[item].name}</span>
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-600">空き</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    {keyCfg.inputMode === 'cycle' ? (
                      <>
                        <span className="text-cyan-300 font-bold">[{keyLabel(keyCfg.cycle)}]</span> 切替 ／{' '}
                        <span className="text-cyan-300 font-bold">[{keyLabel(keyCfg.fire)}]</span> 発動
                      </>
                    ) : (
                      <>各スロットのキーで即発動</>
                    )}
                  </div>
                </div>
              )}

            {/* 発動中アイテムの残り時間カウントダウン（保持アイテムの下）。
                効果が無いときは描画せず、バックログ/アタックゲージはスロット直下に置く。
                効果が出たら自然高さでそのぶん下のゲージ群を押し下げる（お題・スロットは上にあるので動かない）。 */}
            {gameState === 'playing' && activeEffects.length > 0 && (
              <div className="w-full max-w-lg mt-3 flex flex-col gap-1">
                {activeEffects.map((e) => {
                  const dur = ITEM_DURATION[e.type] ?? 1;
                  const remain = Math.max(0, e.until - nowTick);
                  const frac = Math.max(0, Math.min(1, remain / dur));
                  return (
                    <div key={e.type} className="bg-neutral-900/90 border border-white/15 rounded-lg px-3 py-1 flex items-center gap-2">
                      <span className="text-lg leading-none">{ITEM_EMOJI[e.type]}</span>
                      <span className="text-[11px] font-bold text-gray-100 whitespace-nowrap w-20 shrink-0">{ITEM_META[e.type].name}</span>
                      <div className="flex-1 h-2.5 rounded-full bg-neutral-700 overflow-hidden">
                        <div className={`h-full ${e.color} transition-[width] duration-150`} style={{ width: `${frac * 100}%` }} />
                      </div>
                      <span className="text-xs font-mono font-black text-white tabular-nums w-10 text-right">
                        {(remain / 1000).toFixed(1)}<span className="text-[9px] text-gray-400">s</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 自分のバックログ（処理待ち）。満タンでトップアウト＝敗北。 */}
            <div className="w-full max-w-lg mt-4">
              <div className="text-[10px] text-gray-500 mb-0.5">自分のバックログ（満タンで脱落）</div>
              <div className="flex gap-1">
                {Array.from({ length: maxBacklog }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-2 flex-1 rounded-sm ${
                      i < backlog.length ? (i >= maxBacklog - 3 ? 'bg-red-500' : 'bg-cyan-500') : 'bg-neutral-800'
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="mt-3">
              <AttackGauge progress={attackProgress} combo={combo} pinch={isDanger} badges={Math.min(playerKOs, cfgBadgeCap)} threshold={cfgGaugeMode === 'char' ? cfgGaugeChars : attackThreshold} unit={cfgGaugeMode === 'char' ? '文字' : 'クリア'} />
            </div>
            </div>
          </div>

          {gameState === 'start' && (
            // ヘッダー(h-16)の下を画面いっぱいに使う固定オーバーレイ。
            // 画面サイズに合わせてスクロール領域が広がる（収まる時は中央／はみ出す時は上からスクロール）。
            <div className="fixed left-0 right-0 top-16 bottom-0 bg-neutral-950/90 backdrop-blur-sm z-30 overflow-y-auto">
              <div className="min-h-full flex flex-col items-center justify-center w-full py-8 px-2">
              <Swords className="w-20 h-20 text-cyan-500 mb-6" />
              <h2 className="text-4xl font-black tracking-widest mb-2 text-white">TYPE ROYALE</h2>
              <p className="text-gray-400 mb-6 font-mono">Press [SPACE] to Start</p>

              {/* カスタム設定（ソロは常に設定変更可能） */}
              <div className="mb-6 w-full max-w-sm bg-neutral-900/60 border border-amber-700/40 rounded-xl p-4">
                  <div className="text-xs text-amber-300 font-bold mb-3 flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5" /> カスタム設定
                  </div>
                  <div className="block text-[11px] text-gray-400 mb-3">
                    初期供給間隔: <span className="text-cyan-300 font-mono">{(cfgInitial / 1000).toFixed(1)}秒</span>
                    <div className="flex items-center gap-2">
                      <StepBtn onClick={() => setCfgInitial((v) => Math.max(500, v - 100))}>−0.1</StepBtn>
                      <input
                        type="range"
                        min={500}
                        max={6000}
                        step={100}
                        value={cfgInitial}
                        onChange={(e) => setCfgInitial(Number(e.target.value))}
                        className="flex-1 accent-cyan-500"
                      />
                      <StepBtn onClick={() => setCfgInitial((v) => Math.min(6000, v + 100))}>＋0.1</StepBtn>
                    </div>
                  </div>
                  <div className="block text-[11px] text-gray-400 mb-3">
                    最短間隔: <span className="text-cyan-300 font-mono">{(cfgMin / 1000).toFixed(1)}秒</span>
                    <div className="flex items-center gap-2">
                      <StepBtn onClick={() => setCfgMin((v) => Math.max(300, v - 100))}>−0.1</StepBtn>
                      <input
                        type="range"
                        min={300}
                        max={3000}
                        step={100}
                        value={cfgMin}
                        onChange={(e) => setCfgMin(Number(e.target.value))}
                        className="flex-1 accent-cyan-500"
                      />
                      <StepBtn onClick={() => setCfgMin((v) => Math.min(3000, v + 100))}>＋0.1</StepBtn>
                    </div>
                  </div>
                  <div className="block text-[11px] text-gray-400">
                    加速度: <span className="text-cyan-300 font-mono">{accelSpeed.toFixed(1)}</span>
                    <span className="text-gray-600"> （大きいほど速く加速 / 0で加速なし）</span>
                    <div className="flex items-center gap-2 mt-1">
                      <StepBtn onClick={() => setAccelFromSpeed(accelSpeed - 0.5)}>−</StepBtn>
                      <input
                        type="range"
                        min={0}
                        max={10}
                        step={0.5}
                        value={accelSpeed}
                        onChange={(e) => setAccelFromSpeed(Number(e.target.value))}
                        className="flex-1 accent-cyan-500"
                      />
                      <StepBtn onClick={() => setAccelFromSpeed(accelSpeed + 0.5)}>＋</StepBtn>
                    </div>
                  </div>
                  <div className="block text-[11px] text-gray-400 mt-3">
                    自分のHP（積載限界）: <span className="text-cyan-300 font-mono">{cfgHp}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <StepBtn onClick={() => setCfgHp((v) => Math.max(HP_MIN, v - 1))}>−</StepBtn>
                      <input
                        type="range"
                        min={HP_MIN}
                        max={HP_MAX}
                        step={1}
                        value={cfgHp}
                        onChange={(e) => setCfgHp(Number(e.target.value))}
                        className="flex-1 accent-cyan-500"
                      />
                      <StepBtn onClick={() => setCfgHp((v) => Math.min(HP_MAX, v + 1))}>＋</StepBtn>
                    </div>
                  </div>
                  <div className="block text-[11px] text-gray-400 mt-3">
                    敵の数: <span className="text-cyan-300 font-mono">{cfgEnemies}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <StepBtn onClick={() => setCfgEnemies((v) => Math.max(1, v - 1))}>−</StepBtn>
                      <input
                        type="range"
                        min={1}
                        max={MAX_DUMMIES}
                        step={1}
                        value={cfgEnemies}
                        onChange={(e) => setCfgEnemies(Number(e.target.value))}
                        className="flex-1 accent-cyan-500"
                      />
                      <StepBtn onClick={() => setCfgEnemies((v) => Math.min(MAX_DUMMIES, v + 1))}>＋</StepBtn>
                    </div>
                  </div>
                  <div className="block text-[11px] text-gray-400 mt-3">
                    CPUの強さ（平均）: <span className="text-cyan-300 font-mono">{cfgCpuStr}</span>
                    <span className="text-gray-600"> （強弱が混在し平均がこの値）</span>
                    <div className="flex items-center gap-2 mt-1">
                      <StepBtn onClick={() => setCfgCpuStr((v) => Math.max(0, v - 1))}>−</StepBtn>
                      <input
                        type="range"
                        min={0}
                        max={10}
                        step={1}
                        value={cfgCpuStr}
                        onChange={(e) => setCfgCpuStr(Number(e.target.value))}
                        className="flex-1 accent-cyan-500"
                      />
                      <StepBtn onClick={() => setCfgCpuStr((v) => Math.min(10, v + 1))}>＋</StepBtn>
                    </div>
                  </div>
                  <div className="block text-[11px] text-gray-400 mt-3">
                    お宝の出現率: <span className="text-yellow-300 font-mono">{cfgTreasureRate}%</span>
                    <span className="text-gray-600"> （お宝🟨を打つとアイテム入手）</span>
                    <div className="flex items-center gap-2 mt-1">
                      <StepBtn onClick={() => setCfgTreasureRate((v) => Math.max(0, v - 5))}>−</StepBtn>
                      <input
                        type="range"
                        min={0}
                        max={80}
                        step={5}
                        value={cfgTreasureRate}
                        onChange={(e) => setCfgTreasureRate(Number(e.target.value))}
                        className="flex-1 accent-yellow-500"
                      />
                      <StepBtn onClick={() => setCfgTreasureRate((v) => Math.min(80, v + 5))}>＋</StepBtn>
                    </div>
                  </div>
                  <div className="block text-[11px] text-gray-400 mt-3">
                    アイテム
                    <div className="flex gap-1 mt-1">
                      {([[true, 'あり'], [false, 'なし']] as const).map(([on, lbl]) => (
                        <button key={String(on)} onClick={() => setCfgItemsOn(on)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${cfgItemsOn === on ? 'bg-fuchsia-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'}`}>
                          {lbl}
                        </button>
                      ))}
                      <span className="text-gray-600 ml-1 self-center">（なしにするとお宝もアイテムも出ません）</span>
                    </div>
                  </div>
                  <div className="block text-[11px] text-gray-400 mt-3">
                    ゲージ加算方式
                    <div className="flex gap-1 mt-1">
                      {([['word', 'ワード数'], ['char', '文字数']] as const).map(([m, lbl]) => (
                        <button key={m} onClick={() => setCfgGaugeMode(m)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${cfgGaugeMode === m ? 'bg-orange-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'}`}>
                          {lbl}
                        </button>
                      ))}
                      <span className="text-[9px] text-gray-600 self-center ml-1">
                        {cfgGaugeMode === 'char' ? '長い単語ほどゲージが溜まる' : '1ワード=1ゲージ'}
                      </span>
                    </div>
                  </div>
                  {cfgGaugeMode === 'word' ? (
                    <div className="block text-[11px] text-gray-400 mt-3">
                      アタックゲージ（何クリアで発射）: <span className="text-orange-300 font-mono">{cfgAttackGauge}</span>
                      <div className="flex items-center gap-2 mt-1">
                        <StepBtn onClick={() => setCfgAttackGauge((v) => Math.max(2, v - 1))}>−</StepBtn>
                        <input type="range" min={2} max={10} step={1} value={cfgAttackGauge}
                          onChange={(e) => setCfgAttackGauge(Number(e.target.value))} className="flex-1 accent-orange-500" />
                        <StepBtn onClick={() => setCfgAttackGauge((v) => Math.min(10, v + 1))}>＋</StepBtn>
                      </div>
                    </div>
                  ) : (
                    <div className="block text-[11px] text-gray-400 mt-3">
                      アタックゲージ（何文字で発射）: <span className="text-orange-300 font-mono">{cfgGaugeChars}</span>
                      <div className="flex items-center gap-2 mt-1">
                        <StepBtn onClick={() => setCfgGaugeChars((v) => Math.max(6, v - 1))}>−</StepBtn>
                        <input type="range" min={6} max={40} step={1} value={cfgGaugeChars}
                          onChange={(e) => setCfgGaugeChars(Number(e.target.value))} className="flex-1 accent-orange-500" />
                        <StepBtn onClick={() => setCfgGaugeChars((v) => Math.min(40, v + 1))}>＋</StepBtn>
                      </div>
                    </div>
                  )}
                  <div className="block text-[11px] text-gray-400 mt-3">
                    アタック数の上限: <span className="text-orange-300 font-mono">{cfgAttackCap}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <StepBtn onClick={() => setCfgAttackCap((v) => Math.max(2, v - 1))}>−</StepBtn>
                      <input type="range" min={2} max={12} step={1} value={cfgAttackCap}
                        onChange={(e) => setCfgAttackCap(Number(e.target.value))} className="flex-1 accent-orange-500" />
                      <StepBtn onClick={() => setCfgAttackCap((v) => Math.min(12, v + 1))}>＋</StepBtn>
                    </div>
                  </div>
                  <div className="block text-[11px] text-gray-400 mt-3">
                    アタック数が増える連鎖数: <span className="text-orange-300 font-mono">{cfgComboStep}</span>
                    <span className="text-gray-600"> （この連鎖ごとに攻撃量+1）</span>
                    <div className="flex items-center gap-2 mt-1">
                      <StepBtn onClick={() => setCfgComboStep((v) => Math.max(2, v - 1))}>−</StepBtn>
                      <input type="range" min={2} max={15} step={1} value={cfgComboStep}
                        onChange={(e) => setCfgComboStep(Number(e.target.value))} className="flex-1 accent-orange-500" />
                      <StepBtn onClick={() => setCfgComboStep((v) => Math.min(15, v + 1))}>＋</StepBtn>
                    </div>
                  </div>
                  <div className="block text-[11px] text-gray-400 mt-3">
                    バッジ上限（撃破数の補正上限）: <span className="text-yellow-300 font-mono">{cfgBadgeCap}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <StepBtn onClick={() => setCfgBadgeCap((v) => Math.max(0, v - 1))}>−</StepBtn>
                      <input type="range" min={0} max={10} step={1} value={cfgBadgeCap}
                        onChange={(e) => setCfgBadgeCap(Number(e.target.value))} className="flex-1 accent-yellow-500" />
                      <StepBtn onClick={() => setCfgBadgeCap((v) => Math.min(10, v + 1))}>＋</StepBtn>
                    </div>
                  </div>
                  <div className="block text-[11px] text-gray-400 mt-3">
                    バッジ1枚の攻撃上昇率: <span className="text-yellow-300 font-mono">{cfgBadgeRate}%</span>
                    <div className="flex items-center gap-2 mt-1">
                      <StepBtn onClick={() => setCfgBadgeRate((v) => Math.max(0, v - 5))}>−</StepBtn>
                      <input type="range" min={0} max={100} step={5} value={cfgBadgeRate}
                        onChange={(e) => setCfgBadgeRate(Number(e.target.value))} className="flex-1 accent-yellow-500" />
                      <StepBtn onClick={() => setCfgBadgeRate((v) => Math.min(100, v + 5))}>＋</StepBtn>
                    </div>
                  </div>
                  <div className="block text-[11px] text-gray-400 mt-3">
                    逆転補正（劣勢ほど防御・逆転／優勢ほど攻撃が出やすい）
                    <div className="flex gap-1 mt-1">
                      {([[0, 'なし'], [1, '弱'], [2, '中'], [3, '強']] as const).map(([v, lbl]) => (
                        <button key={v} onClick={() => setCfgComeback(v)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${cfgComeback === v ? 'bg-emerald-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'}`}>
                          {lbl}
                        </button>
                      ))}
                      <span className="text-[9px] text-gray-600 self-center ml-1">順位＋ピンチ度で判定</span>
                    </div>
                  </div>

                  {/* アイテムの使い方 */}
                  <div className="mt-4 border-t border-white/10 pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] text-amber-200 font-bold">アイテムの使い方</span>
                      <button
                        onClick={() => setCfgAutoFull((v) => !v)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                          cfgAutoFull ? 'bg-emerald-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'
                        }`}
                      >
                        完全オート {cfgAutoFull ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    {cfgAutoFull ? (
                      <p className="text-[10px] text-emerald-300/80">
                        有利/不利を見て、いい感じのタイミングで自動発動します（手動 [{keyLabel(keyCfg.fire)}] も可）。
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {CAT_META.map((c) => (
                          <div key={c.key} className="flex items-center justify-between gap-2">
                            <span className={`text-[11px] font-bold ${c.color} w-8 shrink-0`}>{c.label}</span>
                            <div className="flex gap-1 flex-wrap justify-end">
                              {USE_MODES.map((m) => (
                                <button
                                  key={m.key}
                                  onClick={() => setCfgUse((u) => ({ ...u, [c.key]: m.key }))}
                                  title={m.desc}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                                    cfgUse[c.key] === m.key ? 'bg-cyan-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'
                                  }`}
                                >
                                  {m.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                        <p className="text-[9px] text-gray-600 leading-tight">
                          新着=[{keyLabel(keyCfg.fire)}]手動 / 即時=拾った瞬間 / オート=良い時に自動 / 保持=1つ保持し被ったら新しい方を発動
                        </p>
                      </div>
                    )}
                  </div>
                </div>

              {/* 出題テーマ選択（複数選択可。「すべて」を選ぶと全語彙） */}
              <div className="mb-6 w-full max-w-sm">
                <div className="text-xs text-gray-500 mb-1.5 text-center">出題テーマ（複数選択可）</div>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {THEMES.map((t) => {
                    const sel = t.id === 'all' ? theme === 'all' || theme === '' : theme.split(',').includes(t.id);
                    return (
                      <button
                        key={t.id}
                        onClick={() => setTheme((cur) => toggleThemeSelection(cur, t.id))}
                        className={`px-2.5 py-1 rounded-full text-xs font-bold transition-colors ${
                          sel ? 'bg-cyan-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'
                        }`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-4 text-sm text-gray-500 bg-neutral-900/50 p-4 rounded-xl">
                <div>🟦 通常単語</div>
                <div>🟥 おじゃま単語</div>
                <div>🟨 お宝単語</div>
              </div>
              <p className="text-xs text-gray-600 mt-4 max-w-sm text-center">
                ノーミスで打ち切ると連鎖UP。5連鎖ごとに敵CPUへおじゃまを送って撃墜！ CPUも反撃してくるので [{keyLabel(keyCfg.target)}] で狙いを切り替えよう。お宝(🟨)を打つと攻撃/防御/効果のスロットにアイテム獲得 → {keyCfg.inputMode === 'cycle' ? `[${keyLabel(keyCfg.cycle)}]でスロット切替・[${keyLabel(keyCfg.fire)}]で発動` : '各スロットの即時キーで発動'}。
              </p>
              <div className="mt-4 text-xs bg-neutral-900/50 p-3 rounded-xl max-w-sm w-full">
                <div className="text-gray-400 font-bold mb-1.5 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-yellow-400" /> アイテム効果（お宝🟨で入手 → スロットへ。{keyCfg.inputMode === 'cycle' ? `[${keyLabel(keyCfg.cycle)}]切替/[${keyLabel(keyCfg.fire)}]発動` : '各スロット即時キー'}）
                </div>
                <div className="flex flex-col gap-2 text-left text-gray-400">
                  {CAT_META.map((c) => (
                    <div key={c.key}>
                      <div className={`text-[11px] font-black mb-0.5 ${c.color}`}>{c.label}</div>
                      <div className="flex flex-col gap-1">
                        {ALL_ITEMS.filter((t) => ITEM_CAT[t] === c.key).map((t) => (
                          <div key={t}>
                            <span className="mr-1">{ITEM_META[t].icon}</span>
                            <span className="text-gray-300 font-bold">{ITEM_META[t].name}</span>
                            <span className="text-gray-500"> … {ITEM_META[t].desc}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ゲージの説明 */}
              <div className="mt-3 mb-2 text-xs bg-neutral-900/50 p-3 rounded-xl max-w-sm w-full">
                <div className="text-gray-400 font-bold mb-1.5">ゲージの見方</div>
                <div className="flex flex-col gap-1 text-left text-gray-500">
                  <div>
                    <span className="text-red-400 font-bold">左の赤ゲージ（着弾予告）</span> … CPUから送られてくるおじゃまの予告。<span className="text-cyan-300">単語を1つ打ち切るごとに1つ相殺（防御）</span>でき、相殺しきれず時間切れになるとバックログに加算される。
                  </div>
                  <div>
                    <span className="text-cyan-400 font-bold">下の青ゲージ（バックログ）</span> … 自分の処理待ちの山。満タンでトップアウト＝敗北。
                  </div>
                  <div>
                    <span className="text-orange-300 font-bold">攻撃チャージ</span> … 一定クリアごとに発射（ゲージ短縮で短くなる）。表示の「+N」がその時送る攻撃量。
                  </div>
                  <div>
                    <span className="text-cyan-300 font-bold">連鎖(COMBO)</span> … ノーミスで打ち切った連続数。長いほど攻撃が増える。
                  </div>
                </div>
              </div>
              </div>
            </div>
          )}

          {gameState === 'gameover' && (
            <div className="absolute inset-0 bg-red-950/90 backdrop-blur-md flex flex-col items-center justify-center z-20 rounded-2xl">
              <h2 className="text-5xl font-black text-white mb-2 tracking-widest drop-shadow-[0_0_15px_rgba(220,38,38,0.8)]">TOP OUT</h2>
              <p className="text-red-300 mb-8">おじゃまブロックがあふれました</p>
              <div className="bg-black/40 p-6 rounded-xl grid grid-cols-3 gap-x-8 gap-y-4 mb-8 border border-red-500/30">
                <Stat label="SCORE" value={score} />
                <Stat label="MAX COMBO" value={maxCombo} />
                <Stat label="K.O." value={playerKOs} />
                <Stat label="KPM" value={calculateKPM()} />
                <Stat label="正タイプ" value={keysTyped} />
                <Stat label="ミス" value={missCount} />
                <Stat label="SEED" value={seed} small />
              </div>
              <p className="text-gray-400 font-mono animate-pulse">Press [SPACE] to Retry</p>
            </div>
          )}

          {gameState === 'win' && (
            <div className="absolute inset-0 bg-emerald-950/90 backdrop-blur-md flex flex-col items-center justify-center z-20 rounded-2xl">
              <Crown className="w-16 h-16 text-yellow-400 mb-3" />
              <h2 className="text-5xl font-black text-white mb-2 tracking-widest drop-shadow-[0_0_15px_rgba(16,185,129,0.8)]">YOU WIN!</h2>
              <p className="text-emerald-300 mb-8">全ての敵を倒した！</p>
              <div className="bg-black/40 p-6 rounded-xl grid grid-cols-3 gap-x-8 gap-y-4 mb-8 border border-emerald-500/30">
                <Stat label="SCORE" value={score} />
                <Stat label="MAX COMBO" value={maxCombo} />
                <Stat label="K.O." value={playerKOs} />
                <Stat label="KPM" value={calculateKPM()} />
                <Stat label="正タイプ" value={keysTyped} />
                <Stat label="ミス" value={missCount} />
                <Stat label="SEED" value={seed} small />
              </div>
              <p className="text-gray-400 font-mono animate-pulse">Press [SPACE] to Retry</p>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2 content-start">
          {dummies.slice(Math.ceil(dummies.length / 2)).map((d) => (
            <div key={d.id} ref={(el) => { dummyRefs.current[d.id] = el; }}>
              <MiniBoard
                height={d.height}
                max={maxBacklog}
                isKO={d.isKO}
                name={d.name}
                combo={d.combo}
                hit={hitDummy === d.id}
                incoming={incomingDummy === d.id}
                itemEmoji={d.itemAt && Date.now() - d.itemAt < 1500 ? ITEM_EMOJI[d.lastItem as ItemType] : undefined}
                str={d.str}
              />
            </div>
          ))}
        </div>
      </main>

      {showSettings && (
        <PlayerSettings onClose={() => { setShowSettings(false); setKeyCfg(loadKeyConfig()); }} />
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .mask-image-top{mask-image:linear-gradient(to bottom,transparent 0%,black 20%);-webkit-mask-image:linear-gradient(to bottom,transparent 0%,black 20%);}
        @keyframes beamFade { 0% { opacity: 0; } 12% { opacity: 1; } 100% { opacity: 0; } }
        .attack-beam { animation: beamFade 0.7s ease-out forwards; }
        @keyframes screenShake {
          0%, 100% { transform: translate(0, 0); }
          20% { transform: translate(-5px, 3px); }
          40% { transform: translate(5px, -3px); }
          60% { transform: translate(-4px, -2px); }
          80% { transform: translate(4px, 2px); }
        }
        .screen-shake { animation: screenShake 0.45s ease-in-out; }
        @keyframes totemAura { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
        .totem-aura { animation: totemAura 1.4s ease-in-out infinite; }
        @keyframes totemRise {
          0% { transform: translateY(20vh) scale(0.6); opacity: 0; }
          15% { opacity: 1; }
          100% { transform: translateY(-110vh) scale(1.1); opacity: 0; }
        }
        .totem-particle { bottom: -3vh; animation: totemRise 2.2s linear infinite; }
        @keyframes totemPulse { 0%,100% { transform: translate(-50%,-50%) scale(1); opacity: 0.7; } 50% { transform: translate(-50%,-50%) scale(1.15); opacity: 1; } }
        .totem-emblem { animation: totemPulse 1.2s ease-in-out infinite; filter: drop-shadow(0 0 18px rgba(250,204,21,0.8)); }
        @keyframes parryRing { 0% { width: 40px; height: 40px; opacity: 0.9; } 100% { width: 360px; height: 360px; opacity: 0; } }
        .parry-ring { width: 40px; height: 40px; animation: parryRing 0.5s ease-out forwards; box-shadow: 0 0 24px rgba(34,211,238,0.8); }
        @keyframes parryLabel { 0% { transform: scale(0.6); opacity: 0; } 30% { transform: scale(1.1); opacity: 1; } 100% { transform: scale(1); opacity: 0; } }
        .parry-label { animation: parryLabel 0.5s ease-out forwards; }
        @keyframes boardFxBanner { 0% { transform: scale(0.6); opacity: 0; } 18% { transform: scale(1.12); opacity: 1; } 80% { transform: scale(1); opacity: 1; } 100% { transform: scale(1); opacity: 0; } }
        .board-fx-banner { animation: boardFxBanner 1.3s ease-out forwards; }
        @keyframes boardFxFlash { 0% { opacity: 0; } 15% { opacity: 1; } 100% { opacity: 0; } }
        .board-fx-flash { animation: boardFxFlash 1.3s ease-out forwards; }
      `,
        }}
      />
    </div>
  );
}

const Hud = ({ label, value, icon, className }: { label: string; value: number; icon?: React.ReactNode; className?: string }) => (
  <div className="flex flex-col items-center">
    <span className="text-xs text-gray-500">{label}</span>
    <span className={`font-mono text-xl font-bold flex items-center gap-1 ${className ?? ''}`}>
      {icon} {value}
    </span>
  </div>
);

const Stat = ({ label, value, small }: { label: string; value: number; small?: boolean }) => (
  <div className="text-center">
    <div className="text-xs text-red-400/80">{label}</div>
    <div className={`font-mono ${small ? 'text-lg' : 'text-3xl'}`}>{value}</div>
  </div>
);

const ItemIcon = ({ type }: { type: ItemType }) => {
  if (type === 'shield') return <Shield className="w-5 h-5 text-blue-300" />;
  if (type === 'clear') return <Wind className="w-5 h-5 text-cyan-300" />;
  if (type === 'brake') return <Pause className="w-5 h-5 text-green-300" />;
  if (type === 'longbomb') return <Bomb className="w-5 h-5 text-red-300" />;
  if (type === 'keep') return <Lock className="w-5 h-5 text-fuchsia-300" />;
  if (type === 'shrink') return <Scissors className="w-5 h-5 text-emerald-300" />;
  if (type === 'parry') return <Shield className="w-5 h-5 text-violet-300" />;
  if (type === 'gaugedown') return <ArrowDownToLine className="w-5 h-5 text-orange-300" />;
  if (type === 'rapid') return <Zap className="w-5 h-5 text-yellow-300" />;
  return <span className="text-base leading-none">{ITEM_EMOJI[type]}</span>;
};

// カスタム設定の ±0.1秒 ステップボタン。
const StepBtn = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-cyan-300 text-xs font-mono font-bold shrink-0"
  >
    {children}
  </button>
);
