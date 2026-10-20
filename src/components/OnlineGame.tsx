import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Swords, Zap, AlertTriangle, Crown, Sparkles, Trophy, Loader2, Eye,
  Target, RotateCcw, LogOut, Volume2, VolumeX, Settings,
} from 'lucide-react';
import { Kbd, IconBtn, Hud } from './ui';
import { mulberry32, type RNG } from '../lib/rng';
import { generateWord, makeOjamaWord, makeOjamaWordFrom, makeShortWord, randomLongWord, newWordBag, setExtraWords, setExcludedThemes } from '../lib/words';
import { loadBgImageMini } from '../lib/theme';
import { processKey, type PlayerState } from '../lib/engine';
import {
  serverNow, writePlayerSummary, finishGame, resetRoom, sendAttack, subscribeAttacks,
  type RoomPlayer, type RoomStatus,
} from '../lib/room';
import { sfx, resumeAudio, setSfxEnabled } from '../lib/sfx';
import {
  ITEM_CAT, ITEM_KIND, ITEM_RARITY, CAT_META, CAT_ORDER, type ItemPrefs, type ItemCat, type UseMode,
  ONLINE_ITEM_META as ITEM_META, ITEM_EMOJI, ITEM_DURATION, BOARD_CHANGE_ITEMS,
  RAPID_DURATION, KEEP_DURATION, PARRY_DURATION, FREEZE_DURATION, DAZZLE_DURATION,
  REFLECT_DURATION, OVERCHARGE_DURATION, SIPHON_DURATION,
} from '../lib/items';
import ItemIcon from './ItemIcon';
import { loadKeyConfig, keyLabel, type KeyConfig } from '../lib/keyconfig';
import PlayerSettings from './PlayerSettings';
import type { Dummy, GameMode, ItemType, TargetMode, Word } from '../lib/types';
import { makeCpu, stepCpu, cpuKps } from '../lib/cpu';
import MiniBoard from './MiniBoard';
import CurrentWord from './CurrentWord';
import AttackGauge from './AttackGauge';
import TrCorners from './TrCorners';
import { computeScore, accuracyOf } from '../lib/scores';

const MAX_BACKLOG = 12;
const INITIAL_SPAWN_INTERVAL = 4000;
const MIN_SPAWN_INTERVAL = 1000;
const WRITE_INTERVAL = 150; // サマリ書込み間隔。観戦の入力画面を滑らかに見せるため短め（小さなJSONなので負荷は軽微）。
const TELEGRAPH_DELAY = 2500; // 着弾予告→確定までの猶予（相殺の反応時間を確保）
const PINCH_RATIO = 0.7;
const PINCH_MULT = 1.5;
const ATTACK_CAP = 5; // 1回の攻撃で送れるおじゃまの上限（即死コンボ防止）
const BOSS_MAX_BACKLOG = 26; // ボスのバックログ上限（＝ボスのHP。多対一なので高め）



const TARGET_MODES: { mode: TargetMode; label: string }[] = [
  { mode: 'random', label: 'ランダム' },
  { mode: 'counter', label: '反撃' },
  { mode: 'finish', label: 'とどめ' },
  { mode: 'strong', label: '強敵' },
];

interface Telegraph {
  id: string;
  amount: number;
  confirmAt: number;
  word?: { display: string; reading: string }; // ジャマーの長文
}

// 生存判定: 脱落していない かつ 接続中（切断したプレイヤーは脱落扱い / Phase 4）。
const isLive = (p: RoomPlayer) => p.alive && p.connected !== false;

interface OnlineGameProps {
  roomId: string;
  uid: string;
  seed: number;
  startAt: number;
  status: RoomStatus;
  hostUid: string;
  category: string;
  mode: GameMode;
  bossUid: string;
  itemRate: number;
  hp?: number;
  spawnMs?: number;
  attackGauge?: number;
  attackCap?: number;
  comboStep?: number;
  badgeCap?: number;
  badgeRate?: number;
  gaugeMode?: 'word' | 'char';
  gaugeChars?: number;
  comeback?: number; // 逆転補正の強さ（0=なし〜3=強）
  itemsOn?: boolean; // アイテム全体のON/OFF（false でお宝・アイテムが出ない）
  disabledItems?: string[]; // 個別にOFFにしたアイテム（排出から除外）
  excludedThemes?: string[]; // 'all'(すべて)出題から除外するテーマid（全員一致）
  customWords?: { display: string; reading: string }[]; // 部屋共有の追加語句
  itemPrefs: ItemPrefs;
  players: Record<string, RoomPlayer>;
  onExit: () => void;
}

export default function OnlineGame({ roomId, uid, seed, startAt, status, hostUid, category, mode, bossUid, itemRate, hp, spawnMs, attackGauge, attackCap, comboStep, badgeCap, badgeRate, gaugeMode, gaugeChars, comeback, itemsOn = true, disabledItems = [], excludedThemes = [], customWords = [], itemPrefs, players, onExit }: OnlineGameProps) {
  // ボスモード関連の派生フラグ。
  const bossMode = mode === 'boss';
  const isBoss = bossMode && uid === bossUid;
  const playerHp = typeof hp === 'number' ? hp : MAX_BACKLOG; // ホスト設定のHP（積載上限）
  const baseSelfMax = isBoss ? BOSS_MAX_BACKLOG : playerHp; // 自分の基礎上限（ボスはHPが多い）
  // 攻撃まわりの設定（ホスト設定。試合中は固定）。
  const atkGauge = typeof attackGauge === 'number' ? attackGauge : 5; // 何クリアで発射
  const atkCap = typeof attackCap === 'number' ? attackCap : ATTACK_CAP; // 攻撃量の上限
  const cStep = typeof comboStep === 'number' ? comboStep : 5; // 何連鎖ごとに+1
  const bCap = typeof badgeCap === 'number' ? badgeCap : 4; // バッジ補正の上限枚数
  const bRate = typeof badgeRate === 'number' ? badgeRate : 25; // バッジ1枚あたり%
  const gMode = gaugeMode === 'char' ? 'char' : 'word'; // ゲージ加算方式
  const gChars = typeof gaugeChars === 'number' ? gaugeChars : 16; // 文字数方式のしきい値
  const comebackK = typeof comeback === 'number' ? comeback : 2; // 逆転補正の強さ（既定=中）
  const selfMax = baseSelfMax; // 自分の上限
  const [started, setStarted] = useState(false);
  const [countdown, setCountdown] = useState(99);
  const [selfAlive, setSelfAlive] = useState(true);
  const [rank, setRank] = useState(0);

  const [backlog, setBacklog] = useState<PlayerState['backlog']>([]);
  const [tokenIndex, setTokenIndex] = useState(0);
  const [currentTyping, setCurrentTyping] = useState('');
  const [typedRomaji, setTypedRomaji] = useState<string[]>([]); // 現在ワードで実際に打った綴り
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [keysTyped, setKeysTyped] = useState(0);
  const [missCount, setMissCount] = useState(0); // ミスタイプ数（リザルト用）
  const [spawnInterval, setSpawnInterval] = useState(typeof spawnMs === 'number' ? spawnMs : INITIAL_SPAWN_INTERVAL);
  const [missFlash, setMissFlash] = useState(false);
  const [romajiHint, setRomajiHint] = useState(false); // ミス時のみ表示モードで、ミス後にローマ字を出す
  const [pending, setPending] = useState<Telegraph[]>([]);
  const [attackFlash, setAttackFlash] = useState<{ amount: number; name: string } | null>(null);
  // アイテムは攻撃/防御/妨害の3スロットで保持。Spaceで選択切替、Enterで発動。
  const [slots, setSlots] = useState<Record<ItemCat, ItemType | null>>({ attack: null, defense: null, timed: null });
  const [selectedSlot, setSelectedSlot] = useState<ItemCat>('attack');
  const [itemFlash, setItemFlash] = useState(false);
  const [targetMode, setTargetMode] = useState<TargetMode>('random');
  const [muted, setMuted] = useState(false);
  const [attackProgress, setAttackProgress] = useState(0); // 次の攻撃までのゲージ（ミスで減らない）
  const [nowTick, setNowTick] = useState(0); // カウントダウン描画用の時刻
  const [dazzleUntil, setDazzleUntil] = useState(0); // 視認性低下を食らっている終了時刻（自分の画面をゲーミング化）
  const [resultTab, setResultTab] = useState<'rank' | 'score' | 'ko' | 'kpm'>('score'); // 結果画面の表示切替
  // エフェクト用
  const [beams, setBeams] = useState<{ id: number; x1: number; y1: number; x2: number; y2: number; color: string }[]>([]);
  // 撃破パーティクル（画面座標に散る破片）／衝撃波リング／ヒットストップ。
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number; color: string; parts: { dx: number; dy: number; s: number }[] }[]>([]);
  const burstIdRef = useRef(0);
  const [rings, setRings] = useState<{ id: number; x: number; y: number; color: string; size: number }[]>([]);
  const ringIdRef = useRef(0);
  const [hitStop, setHitStop] = useState(false);
  const [hitId, setHitId] = useState<string | null>(null); // 自分が攻撃した相手
  const [incomingId, setIncomingId] = useState<string | null>(null); // 自分を攻撃してきた相手
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: 'ko' | 'in' | 'item'; at: number }[]>([]);
  const [selfLog, setSelfLog] = useState<{ id: number; item: ItemType; at: number }[]>([]); // 自分のアイテム使用履歴
  const [shake, setShake] = useState(false);
  const [damageFlash, setDamageFlash] = useState(false); // 被弾時の赤フラッシュ
  const [useFlash, setUseFlash] = useState<ItemType | null>(null); // 自分のアイテム発動演出
  const [boardFx, setBoardFx] = useState<ItemType | null>(null); // 盤面変化系の強調演出
  const [parryFx, setParryFx] = useState(false); // 受け流し成功エフェクト
  const [watchId, setWatchId] = useState<string | null>(null); // 観戦中に覗いているプレイヤー
  const [showSettings, setShowSettings] = useState(false); // プレイヤー設定モーダル
  const [keyCfg, setKeyCfg] = useState<KeyConfig>(() => loadKeyConfig());
  const keyConfigRef = useRef<KeyConfig>(keyCfg);
  useEffect(() => { keyConfigRef.current = keyCfg; }, [keyCfg]);
  const settingsOpenRef = useRef(false);
  useEffect(() => { settingsOpenRef.current = showSettings; }, [showSettings]);

  const centerRef = useRef<HTMLDivElement>(null);
  const boardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const beamIdRef = useRef(0);
  const toastIdRef = useRef(0);
  const prevPlayersRef = useRef(players);

  const startTimeRef = useRef(0);
  const endTimeRef = useRef(0); // ゲーム終了時刻（KPM固定用）
  const wordRngRef = useRef<RNG | null>(null);
  const itemRngRef = useRef<RNG | null>(null);
  const stateRef = useRef<PlayerState>({ backlog, tokenIndex, currentTyping, combo, gameState: 'playing' });
  const selfAliveRef = useRef(true);
  const scoreWrittenRef = useRef(false); // 総合スコアの二重書込ガード（1試合1回）
  const playersRef = useRef(players);
  // CPU（擬似プレイヤー）のシミュレーション状態（ホストのみ使用）。
  const cpuSimRef = useRef<Record<string, { d: Dummy; rank: number; koBy: string }>>({});
  const slotsRef = useRef(slots);
  const selectedSlotRef = useRef(selectedSlot);
  const targetModeRef = useRef(targetMode);
  const lastAttackerRef = useRef('');
  const shieldRef = useRef(false);
  const rapidUntilRef = useRef(0);
  const keepUntilRef = useRef(0);
  const parryUntilRef = useRef(0);
  const freezeUntilRef = useRef(0); // フリーズ（着弾予告/供給停止）
  const barrierRef = useRef(false); // バリア（次の被弾を1回防ぐ）
  const guardCountRef = useRef(0); // ガード（自動供給を複数回防ぐ）
  const focusNextRef = useRef(false); // 会心: 次のボスへの攻撃を倍化
  const reflectUntilRef = useRef(0); // リフレクト（被攻撃を送り主へ跳ね返す）
  const overchargeUntilRef = useRef(0); // オーバーチャージ（ゲージ倍速）
  const siphonUntilRef = useRef(0); // サイフォン（攻撃命中で自分のHP回復）
  const bagRef = useRef(newWordBag()); // 出題バッグ（全語を1巡するまで重複させない・シード共有で全員同一）
  const attackProgressRef = useRef(0);
  const categoryRef = useRef(category);
  useEffect(() => {
    categoryRef.current = category;
  }, [category]);
  const itemRateRef = useRef(itemRate);
  useEffect(() => {
    itemRateRef.current = itemRate;
  }, [itemRate]);
  const itemsOnRef = useRef(itemsOn); // アイテムON/OFF（OFFならお宝もアイテムも出さない）
  useEffect(() => { itemsOnRef.current = itemsOn; }, [itemsOn]);
  const disabledItemsRef = useRef<Set<string>>(new Set(disabledItems)); // 個別OFFのアイテム
  useEffect(() => { disabledItemsRef.current = new Set(disabledItems); }, [disabledItems]);
  // アイテムの使い方設定（自分用）。ゲーム中に参照するため ref で保持。
  const autoFullRef = useRef(itemPrefs.autoFull);
  const useModeRef = useRef(itemPrefs.use);
  useEffect(() => {
    autoFullRef.current = itemPrefs.autoFull;
    useModeRef.current = itemPrefs.use;
  }, [itemPrefs]);
  const pendingRef = useRef<Telegraph[]>([]);
  const updatePending = useCallback((next: Telegraph[]) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  // 単語生成（近接重複を避ける）。エントリ列はシード共有なので recent も全員同一になり、
  // 引き直しの rng 消費数も一致＝同期は崩れない。種別はローカル乱数（localType）。
  const genWord = useCallback((): Word => {
    const rng = wordRngRef.current!;
    return generateWord(rng, categoryRef.current, bagRef.current, true, itemsOnRef.current ? itemRateRef.current / 100 : 0, 0);
  }, []);

  const pushToast = useCallback((text: string, kind: 'ko' | 'in' | 'item') => {
    const id = toastIdRef.current++;
    setToasts((t) => [...t, { id, text, kind, at: Date.now() }].slice(-24));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const addBeam = useCallback((x1: number, y1: number, x2: number, y2: number, color: string) => {
    const id = beamIdRef.current++;
    setBeams((b) => [...b, { id, x1, y1, x2, y2, color }]);
    setTimeout(() => setBeams((b) => b.filter((x) => x.id !== id)), 700);
  }, []);

  // パーティクルを発火（画面座標中心に破片を放射）。big=撃破用に多く・大きく・重力落下。
  const addBurst = useCallback((x: number, y: number, color: string, big = false) => {
    const id = burstIdRef.current++;
    const n = big ? 26 : 12;
    const parts = Array.from({ length: n }).map(() => {
      const a = Math.random() * Math.PI * 2;
      const r = (big ? 60 : 30) + Math.random() * (big ? 150 : 70);
      return { dx: Math.cos(a) * r, dy: Math.sin(a) * r - (big ? 30 : 15) + 40, s: (big ? 4 : 2.5) + Math.random() * (big ? 7 : 4) };
    });
    setBursts((b) => [...b, { id, x, y, color, parts }]);
    setTimeout(() => setBursts((b) => b.filter((z) => z.id !== id)), 800);
  }, []);

  // 衝撃波リングを発火。
  const addRing = useCallback((x: number, y: number, color: string, size = 120) => {
    const id = ringIdRef.current++;
    setRings((r) => [...r, { id, x, y, color, size }]);
    setTimeout(() => setRings((r) => r.filter((z) => z.id !== id)), 620);
  }, []);

  // 撃破: 相手ボード中心に大爆発（破片＋リング＋シェイク＋ヒットストップ＋SE）。
  const koFx = useCallback((targetId: string, color = 'var(--charge)') => {
    const r = boardRefs.current[targetId]?.getBoundingClientRect();
    if (r) {
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      addBurst(cx, cy, color, true);
      addRing(cx, cy, color, 150);
    }
    sfx.explode();
    setShake(true);
    setTimeout(() => setShake(false), 400);
    setHitStop(true);
    setTimeout(() => setHitStop(false), 90);
  }, [addBurst, addRing]);

  // 自分のボード → 対象ミニボードへ攻撃ビーム（オレンジ）。
  const fireBeam = useCallback(
    (targetId: string) => {
      const from = centerRef.current?.getBoundingClientRect();
      const to = boardRefs.current[targetId]?.getBoundingClientRect();
      setHitId(targetId);
      setTimeout(() => setHitId((cur) => (cur === targetId ? null : cur)), 650);
      if (!from || !to) return;
      addBeam(from.left + from.width / 2, from.top + from.height * 0.35, to.left + to.width / 2, to.top + to.height / 2, '#fb923c');
    },
    [addBeam],
  );

  // 攻撃してきた相手 → 自分のボードへ被弾ビーム（赤）＋画面赤フラッシュ＋シェイク。
  const fireIncoming = useCallback(
    (fromId: string) => {
      setIncomingId(fromId);
      setTimeout(() => setIncomingId((cur) => (cur === fromId ? null : cur)), 650);
      setDamageFlash(true);
      setTimeout(() => setDamageFlash(false), 220);
      setShake(true);
      setTimeout(() => setShake(false), 350);
      const from = boardRefs.current[fromId]?.getBoundingClientRect();
      const to = centerRef.current?.getBoundingClientRect();
      if (!from || !to) return;
      addBeam(from.left + from.width / 2, from.top + from.height / 2, to.left + to.width / 2, to.top + to.height * 0.35, '#ef4444');
    },
    [addBeam],
  );

  useEffect(() => {
    stateRef.current = { backlog, tokenIndex, currentTyping, combo, gameState: 'playing' };
  }, [backlog, tokenIndex, currentTyping, combo]);
  useEffect(() => { selfAliveRef.current = selfAlive; }, [selfAlive]);
  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { slotsRef.current = slots; }, [slots]);
  useEffect(() => { selectedSlotRef.current = selectedSlot; }, [selectedSlot]);
  const setSlot = useCallback((cat: ItemCat, val: ItemType | null) => {
    setSlots((s) => ({ ...s, [cat]: val }));
    slotsRef.current = { ...slotsRef.current, [cat]: val };
  }, []);
  useEffect(() => { targetModeRef.current = targetMode; }, [targetMode]);

  const calculateKPM = useCallback(() => {
    if (!startTimeRef.current || keysTyped === 0) return 0;
    // 終了後は終了時刻で固定（裏で時間が進んで KPM が下がるのを防ぐ）。
    const end = endTimeRef.current || Date.now();
    const minutes = Math.max(1 / 600, (end - startTimeRef.current) / 60000);
    return Math.floor(keysTyped / minutes);
  }, [keysTyped]);

  // 秒間打鍵数（KPS, 小数1桁）。
  const calculateKPS = useCallback(() => {
    if (!startTimeRef.current || keysTyped === 0) return 0;
    const end = endTimeRef.current || Date.now();
    const seconds = Math.max(0.1, (end - startTimeRef.current) / 1000);
    return Math.round((keysTyped / seconds) * 10) / 10;
  }, [keysTyped]);

  // 自分が稼いだバッジ数（自分にトドメ＝koBy===uid のプレイヤー数）。
  const myBadges = Object.values(players).filter((p) => p.koBy === uid).length;

  // シードから RNG と初期バックログを生成（全員同一）。アイテム抽選用は別系列。
  useEffect(() => {
    // 部屋共有の追加語句を出題プールへ反映（全員同じ並び＝シード同期が崩れない）。genWord より前に必須。
    setExtraWords(customWords);
    setExcludedThemes(excludedThemes); // OFFにしたテーマを「すべて」出題から除外（全員一致）
    const rng = mulberry32(seed >>> 0);
    wordRngRef.current = rng;
    itemRngRef.current = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    // 種別はローカル乱数で（お宝＝アイテムが各プレイヤーに確実に出るように）。出現率はホスト設定。
    bagRef.current = newWordBag(); // 出題バッグを新しい1巡でリセット
    setWatchId(null);
    setSelfLog([]);
    setToasts([]);
    setTypedRomaji([]);
    setBacklog([genWord(), genWord(), genWord()]);
    setSpawnInterval(typeof spawnMs === 'number' ? spawnMs : INITIAL_SPAWN_INTERVAL);
    attackProgressRef.current = 0;
    setAttackProgress(0);
    keepUntilRef.current = 0;
    rapidUntilRef.current = 0;
    parryUntilRef.current = 0;
    freezeUntilRef.current = 0;
    reflectUntilRef.current = 0;
    overchargeUntilRef.current = 0;
    siphonUntilRef.current = 0;
    barrierRef.current = false;
    guardCountRef.current = 0;
    endTimeRef.current = 0;
    scoreWrittenRef.current = false;
    setKeysTyped(0);
    setMissCount(0);
    setSlots({ attack: null, defense: null, timed: null });
    setSelectedSlot('attack');
    slotsRef.current = { attack: null, defense: null, timed: null };
    // 新しいゲーム開始時に自分の状態をリセット（再戦対応）。盤面背景画像は開始時に一度だけ書込（共有）。
    writePlayerSummary(roomId, uid, { alive: true, rank: 0, backlog: 3, combo: 0, koBy: '', boardImg: loadBgImageMini() ?? '' });
    // ホストは CPU の生存も復活させておく（カウントダウン中に反映させ、開始直後の誤決着を防ぐ）。
    if (uid === hostUid) {
      cpuSimRef.current = {};
      for (const [id, p] of Object.entries(playersRef.current)) {
        if (p.isCpu) writePlayerSummary(roomId, id, { alive: true, rank: 0, backlog: 3, combo: 0, koBy: '', kpm: 0 });
      }
    }
  }, [seed, roomId, uid, genWord, hostUid]);

  // startAt に達したらゲーム開始。それまではカウントダウン（秒ごとにビープ）。
  const lastBeepRef = useRef(99);
  useEffect(() => {
    if (started) return;
    resumeAudio();
    const tick = () => {
      const remain = startAt - serverNow();
      if (remain <= 0) {
        setStarted(true);
        startTimeRef.current = Date.now();
        sfx.start();
      } else {
        const sec = Math.ceil(remain / 1000);
        setCountdown(sec);
        if (sec !== lastBeepRef.current && sec <= 3) {
          lastBeepRef.current = sec;
          sfx.countdown();
        }
      }
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [startAt, started]);

  // 決着時、まだ脱落していない（勝者）なら KPS をこの時点で固定する。
  useEffect(() => {
    if (status === 'finished' && endTimeRef.current === 0) endTimeRef.current = Date.now();
  }, [status]);

  // 試合終了（決着 or 自分の脱落）時、総合スコアをランキング用に書き込む（1試合1回）。
  useEffect(() => {
    if (!started || scoreWrittenRef.current) return;
    if (status !== 'finished' && selfAlive) return; // まだ終わっていない
    scoreWrittenRef.current = true;
    const end = endTimeRef.current || Date.now();
    const seconds = Math.max(0.1, (end - startTimeRef.current) / 1000);
    const kps = Math.round((keysTyped / seconds) * 10) / 10;
    writePlayerSummary(roomId, uid, {
      score: computeScore({ keys: keysTyped, miss: missCount, seconds, maxCombo }),
      keys: keysTyped,
      kps,
      acc: accuracyOf(keysTyped, missCount),
    });
  }, [status, selfAlive, started, keysTyped, missCount, maxCombo, roomId, uid]);

  // 自分が脱落。順位と KO クレジット（koBy）を確定。
  const topOut = useCallback(() => {
    if (!selfAliveRef.current) return;
    // ボスは挑戦者が全滅していれば勝利確定。決着の伝播待ちに過積載で自滅しないようにする。
    if (bossMode && isBoss) {
      const aliveChallengers = Object.entries(playersRef.current).filter(([id, p]) => id !== bossUid && isLive(p)).length;
      if (aliveChallengers === 0) return;
    }
    selfAliveRef.current = false;
    endTimeRef.current = Date.now(); // KPM をこの時点で固定
    const aliveCount = Object.values(playersRef.current).filter(isLive).length;
    const myRank = Math.max(1, aliveCount);
    setRank(myRank);
    setSelfAlive(false);
    sfx.gameover();
    setShake(true);
    setTimeout(() => setShake(false), 500);
    writePlayerSummary(roomId, uid, { alive: false, rank: myRank, backlog: selfMax, koBy: lastAttackerRef.current });
  }, [roomId, uid, selfMax, bossMode, isBoss, bossUid]);

  // 他プレイヤーの脱落を検知してトースト表示（自分の撃破なら強調）。
  useEffect(() => {
    const prev = prevPlayersRef.current;
    for (const [id, p] of Object.entries(players)) {
      if (id === uid) continue;
      const prevP = prev[id];
      const wasLive = prevP && prevP.alive && prevP.connected !== false;
      if (wasLive && !isLive(p)) {
        if (p.koBy === uid) {
          pushToast(`${p.name} を撃破！`, 'ko');
          koFx(id);
        } else {
          pushToast(`${p.name} 脱落`, 'in');
          sfx.eliminate();
        }
      }
      // 他プレイヤーのアイテム使用を検知
      if (p.itemAt && prevP && p.itemAt !== prevP.itemAt && p.lastItem) {
        const meta = ITEM_META[p.lastItem as ItemType];
        pushToast(`${p.name} が ${meta ? meta.name : 'アイテム'} 使用`, 'item');
      }
    }
    prevPlayersRef.current = players;
  }, [players, uid, pushToast, koFx]);

  // ターゲット選択（4モード / 仕様 §3.4）。
  const pickTarget = useCallback(() => {
    // ボスモード: 挑戦者は常にボスを狙い、ボスは挑戦者の中から狙う。
    if (bossMode) {
      if (isBoss) {
        const challengers = Object.entries(playersRef.current).filter(([id, p]) => id !== bossUid && isLive(p));
        if (challengers.length === 0) return null;
        const m = targetModeRef.current;
        if (m === 'finish' || m === 'strong')
          return challengers.reduce((best, cur) => (cur[1].backlog > best[1].backlog ? cur : best))[0];
        return challengers[Math.floor(Math.random() * challengers.length)][0];
      }
      // 挑戦者: ボスが生きていればボスを狙う。
      return isLive(playersRef.current[bossUid]) ? bossUid : null;
    }
    const alive = Object.entries(playersRef.current).filter(([id, p]) => id !== uid && isLive(p));
    if (alive.length === 0) return null;
    const mode = targetModeRef.current;
    if (mode === 'counter') {
      const la = lastAttackerRef.current;
      const found = alive.find(([id]) => id === la);
      if (found) return found[0];
    } else if (mode === 'finish') {
      return alive.reduce((best, cur) => (cur[1].backlog > best[1].backlog ? cur : best))[0];
    } else if (mode === 'strong') {
      return alive.reduce((best, cur) => (cur[1].badges > best[1].badges ? cur : best))[0];
    }
    return alive[Math.floor(Math.random() * alive.length)][0];
  }, [uid, bossMode, isBoss, bossUid]);

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

  // 指定量を送る共通処理: 受信予告と相殺 → 余剰を相手へ。
  const sendAmount = useCallback(
    (amount: number) => {
      if (amount <= 0) return;
      let remaining = amount;
      const sorted = [...pendingRef.current].sort((a, b) => a.confirmAt - b.confirmAt);
      for (const e of sorted) {
        if (remaining <= 0) break;
        if (e.word) continue; // 長文（ジャマー）は相殺対象外で必ず着弾する
        const cut = Math.min(remaining, e.amount);
        e.amount -= cut;
        remaining -= cut;
      }
      updatePending(sorted.filter((e) => e.amount > 0 || e.word));
      sfx.attack();
      if (remaining > 0) {
        // サイフォン中は、攻撃が出る（命中する）たびに自分のバックログを1回復。
        if (Date.now() < siphonUntilRef.current) {
          setBacklog((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
        }
        const targetId = pickTarget();
        if (targetId) {
          const targetName = playersRef.current[targetId]?.name || '相手';
          sendAttack(roomId, targetId, uid, remaining);
          fireBeam(targetId);
          setAttackFlash({ amount: remaining, name: targetName });
        } else {
          setAttackFlash({ amount: remaining, name: '' });
        }
      } else {
        setAttackFlash({ amount: 0, name: '相殺！' });
      }
      setTimeout(() => setAttackFlash(null), 700);
    },
    [roomId, uid, updatePending, pickTarget, fireBeam],
  );

  // 連鎖マイルストーン攻撃: 倍率・上限を適用して送信。
  const launchAttack = useCallback(
    (comboVal: number) => {
      // ゲージ発射ごとに、攻撃量は連鎖に応じて増える（cStep 連鎖ごとに+1）。
      let amount = 1 + Math.floor(comboVal / cStep);
      if (stateRef.current.backlog.length / selfMax >= PINCH_RATIO) amount = Math.round(amount * PINCH_MULT);
      const badges = Object.values(playersRef.current).filter((p) => p.koBy === uid).length;
      amount = Math.round(amount * (1 + (bRate / 100) * Math.min(badges, bCap)));
      amount = Math.min(amount, atkCap);
      // 会心: 次のボスへの攻撃を倍化（上限を少し緩める）。
      if (focusNextRef.current) {
        focusNextRef.current = false;
        amount = Math.min(amount * 2, atkCap * 2);
      }
      sendAmount(amount);
    },
    [uid, sendAmount, selfMax, cStep, atkCap, bCap, bRate],
  );

  // アイテム効果適用（所持状態のクリアは行わない）。
  const applyItem = useCallback(
    (item: ItemType) => {
      // 自分の発動演出＋他プレイヤーへ「誰が何を使ったか」を共有
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
      writePlayerSummary(roomId, uid, { lastItem: item, itemAt: Date.now() });
      if (item === 'shield') shieldRef.current = true;
      else if (item === 'clear')
        setBacklog((prev) => (prev.length <= 1 ? prev : [prev[0], ...prev.slice(1).filter((w) => w.type !== 'ojama')]));
      else if (item === 'rapid') {
        rapidUntilRef.current = Date.now() + RAPID_DURATION;
      } else if (item === 'keep') {
        keepUntilRef.current = Date.now() + KEEP_DURATION;
      } else if (item === 'parry') {
        parryUntilRef.current = Date.now() + PARRY_DURATION;
      } else if (item === 'meteor') {
        // ボス: 全挑戦者へ一斉攻撃。
        const challengers = Object.entries(playersRef.current).filter(([id, p]) => id !== bossUid && isLive(p));
        for (const [id] of challengers) {
          sendAttack(roomId, id, uid, 2);
          fireBeam(id);
        }
        setAttackFlash({ amount: 2, name: `全挑戦者へメテオ 🌠` });
        setTimeout(() => setAttackFlash(null), 800);
        sfx.attack();
      } else if (item === 'quake') {
        // ボス: 最もバックログが多い挑戦者へトドメ。
        const challengers = Object.entries(playersRef.current).filter(([id, p]) => id !== bossUid && isLive(p));
        if (challengers.length > 0) {
          const t = challengers.reduce((best, cur) => (cur[1].backlog > best[1].backlog ? cur : best));
          sendAttack(roomId, t[0], uid, 5);
          fireBeam(t[0]);
          setAttackFlash({ amount: 5, name: `${t[1].name} へ地割れ 🌋` });
          setTimeout(() => setAttackFlash(null), 800);
          sfx.attack();
        }
      } else if (item === 'regen') {
        // ボス: 自分のバックログ（HP）を回復。先頭は残す。
        setBacklog((prev) => (prev.length <= 1 ? prev : [prev[0], ...prev.slice(1, Math.max(1, prev.length - 6))]));
        sfx.item();
      } else if (item === 'rally') {
        // 挑戦者: ボスへ即時の大攻撃。
        if (isLive(playersRef.current[bossUid])) {
          sendAttack(roomId, bossUid, uid, 3);
          fireBeam(bossUid);
          setAttackFlash({ amount: 3, name: `ボスへ総攻撃 ⚔` });
          setTimeout(() => setAttackFlash(null), 800);
          sfx.attack();
        }
      } else if (item === 'focus') {
        // 挑戦者: 次のボスへの攻撃を倍化。
        focusNextRef.current = true;
      }
      // --- 防御 ---
      else if (item === 'barrier') barrierRef.current = true;
      else if (item === 'freeze') freezeUntilRef.current = Date.now() + FREEZE_DURATION;
      else if (item === 'guard') guardCountRef.current = 2;
      else if (item === 'purge') {
        // 大掃除: バックログを丸ごと空にし、簡単な単語を1つだけ残す（逆転のチャンス）。
        setBacklog([makeShortWord('normal', categoryRef.current)]);
        setTokenIndex(0);
        setCurrentTyping('');
        setTypedRomaji([]);
      }
      // --- 攻撃 ---
      else if (item === 'snipe') {
        // 狙撃: 最も危険な（バックログが多い）相手にトドメの単発大ダメージ。
        const cands = Object.entries(playersRef.current).filter(([id, p]) => id !== uid && isLive(p) && (!bossMode || isBoss || id === bossUid));
        const t = cands.length ? cands.reduce((b, c) => (c[1].backlog > b[1].backlog ? c : b))[0] : null;
        if (t) {
          sendAttack(roomId, t, uid, 4);
          fireBeam(t);
          setAttackFlash({ amount: 4, name: `${playersRef.current[t]?.name || '相手'} を狙撃` });
          setTimeout(() => setAttackFlash(null), 800);
          sfx.attack();
        }
      } else if (item === 'heavy') {
        sendAmount(Math.min(Math.max(2, Math.floor(stateRef.current.combo / 3)), 6));
      } else if (item === 'burst') {
        // 全ての相手へ一斉に +2。
        const opponents = bossMode
          ? isBoss
            ? Object.keys(playersRef.current).filter((id) => id !== bossUid && isLive(playersRef.current[id]))
            : isLive(playersRef.current[bossUid])
              ? [bossUid]
              : []
          : Object.entries(playersRef.current)
              .filter(([id, p]) => id !== uid && isLive(p))
              .map(([id]) => id);
        for (const id of opponents) {
          sendAttack(roomId, id, uid, 2);
          fireBeam(id);
        }
        setAttackFlash({ amount: 2, name: 'バースト！ 全体+2' });
        setTimeout(() => setAttackFlash(null), 800);
        sfx.attack();
      }
      // --- 妨害 ---
      else if (item === 'flood') {
        // フラッド: 狙った相手へ +1 を5連発（個別の着弾予告＝相殺しにくい波状攻撃）。
        const t = pickTarget();
        if (t) {
          for (let i = 0; i < 5; i++) sendAttack(roomId, t, uid, 1);
          fireBeam(t);
          setAttackFlash({ amount: 5, name: `${playersRef.current[t]?.name || '相手'} へフラッド波状` });
          setTimeout(() => setAttackFlash(null), 800);
          sfx.attack();
        }
      } else if (item === 'drain') {
        setBacklog((prev) => (prev.length <= 1 ? prev : [prev[0], ...prev.slice(1, Math.max(1, prev.length - 2))]));
        const t = pickTarget();
        if (t) {
          sendAttack(roomId, t, uid, 2);
          fireBeam(t);
          sfx.attack();
        }
      } else if (item === 'mirror') {
        sendAmount(Math.min(Math.max(1, Math.floor(stateRef.current.backlog.length / 3)), 6));
      }
      // --- お宝/HP ---
      else if (item === 'goldify') {
        // 溜まっているワードを全てお宝に変える（おじゃまは除く）。
        setBacklog((prev) => prev.map((w) => (w.type === 'ojama' ? w : { ...w, type: 'treasure' as const })));
        sfx.item();
      }
      // --- オンライン専用 ---
      else if (item === 'reflect') {
        reflectUntilRef.current = Date.now() + REFLECT_DURATION;
        sfx.use();
      } else if (item === 'overcharge') {
        overchargeUntilRef.current = Date.now() + OVERCHARGE_DURATION;
        sfx.use();
      } else if (item === 'siphon') {
        siphonUntilRef.current = Date.now() + SIPHON_DURATION;
        sfx.use();
      } else if (item === 'thunder') {
        // 首位（最も連鎖が高い）の生存相手へ落雷の大ダメージ。
        const cands = Object.entries(playersRef.current).filter(([id, p]) => id !== uid && isLive(p) && (!bossMode || isBoss || id === bossUid));
        const t = cands.length ? cands.reduce((b, c) => ((c[1].combo || 0) > (b[1].combo || 0) ? c : b))[0] : null;
        if (t) {
          sendAttack(roomId, t, uid, 5);
          fireBeam(t);
          setAttackFlash({ amount: 5, name: `${playersRef.current[t]?.name || '相手'} へ落雷⚡` });
          setTimeout(() => setAttackFlash(null), 800);
          sfx.attack();
        }
      } else if (item === 'jammer') {
        // 全相手へ長文おじゃまを送りつけて手を止める。
        const opponents = bossMode
          ? isBoss
            ? Object.keys(playersRef.current).filter((id) => id !== bossUid && isLive(playersRef.current[id]))
            : isLive(playersRef.current[bossUid]) ? [bossUid] : []
          : Object.entries(playersRef.current).filter(([id, p]) => id !== uid && isLive(p)).map(([id]) => id);
        // 既に長文を抱えている相手は除外（重ねがけ防止）。
        const jamTargets = opponents.filter((id) => !playersRef.current[id]?.hasLong);
        for (const id of jamTargets) {
          sendAttack(roomId, id, uid, 1, randomLongWord());
          fireBeam(id);
        }
        setAttackFlash({ amount: jamTargets.length, name: '全体へジャマー📡' });
        setTimeout(() => setAttackFlash(null), 800);
        sfx.attack();
      } else if (item === 'dazzle') {
        // 視認性低下: 狙った相手の画面を一定時間ゲーミング(虹色)に光らせる（おじゃまではなく演出デバフ）。
        const targetId = pickTarget();
        if (targetId) {
          sendAttack(roomId, targetId, uid, 0, undefined, 'dazzle');
          fireBeam(targetId);
          const name = playersRef.current[targetId]?.name || '相手';
          setAttackFlash({ amount: 1, name: `${name} を視認性低下🌈` });
          setTimeout(() => setAttackFlash(null), 800);
          sfx.attack();
        }
      }
    },
    [pickTarget, fireBeam, roomId, uid, bossUid, bossMode, isBoss, sendAmount],
  );

  const grantItem = useCallback(() => {
    const rng = itemRngRef.current;
    let items: ItemType[];
    // 統合・削除した shield/clear/heavy/mirror はドロップから除外。
    // オンライン専用 reflect/overcharge/thunder/jammer/siphon を追加。
    if (bossMode && isBoss) {
      // ボス専用＋自衛系＋全体攻撃。
      items = ['meteor', 'quake', 'regen', 'keep', 'barrier', 'freeze', 'guard', 'snipe', 'burst', 'flood', 'goldify', 'reflect', 'overcharge', 'thunder', 'jammer', 'siphon', 'dazzle'];
    } else if (bossMode) {
      // 挑戦者: 攻撃協力系を多めに＋追加アイテム。
      items = ['rapid', 'keep', 'parry', 'rally', 'focus', 'barrier', 'freeze', 'purge', 'guard', 'snipe', 'burst', 'flood', 'drain', 'goldify', 'reflect', 'overcharge', 'thunder', 'jammer', 'siphon', 'dazzle'];
    } else {
      items = ['rapid', 'keep', 'parry', 'barrier', 'freeze', 'purge', 'guard', 'snipe', 'burst', 'flood', 'drain', 'goldify', 'reflect', 'overcharge', 'thunder', 'jammer', 'siphon', 'dazzle'];
    }
    // 個別にOFFにされたアイテムを除外。
    if (disabledItemsRef.current.size > 0) items = items.filter((it) => !disabledItemsRef.current.has(it));
    if (items.length === 0) return; // 候補が無ければ何も出さない
    // 有利/不利でドロップ内容を変える。基準は「自分のピンチ度（バックログ量）」と
    // 「生存者中の順位（相対的な劣勢）」を半々で合成。劣勢ほど防御/逆転、優勢ほど攻撃。
    const pinch = Math.min(1, stateRef.current.backlog.length / selfMax);
    const live = Object.values(playersRef.current).filter(isLive);
    const myBak = stateRef.current.backlog.length;
    const behind = Object.entries(playersRef.current).filter(([id, p]) => id !== uid && isLive(p) && (p.backlog || 0) < myBak).length;
    const rankBehind = live.length > 1 ? behind / (live.length - 1) : 0; // 0=首位 .. 1=最下位
    const dis = Math.min(1, 0.5 * pinch + 0.5 * rankBehind);
    const bias = (dis - 0.5) * 2; // -1（優勢）..+1（劣勢）
    const defBoost = 1 + Math.max(0, bias) * comebackK;
    const atkBoost = 1 + Math.max(0, -bias) * comebackK;
    const weighted = items.map((it) => {
      const kind = ITEM_KIND[it];
      let w = kind === 'def' ? defBoost : kind === 'atk' ? atkBoost : 1;
      w *= ITEM_RARITY[it] ?? 1; // レアリティ係数（大掃除など強力アイテムを抑える）
      return { it, w };
    });
    const total = weighted.reduce((s, x) => s + x.w, 0);
    let acc = (rng ? rng() : Math.random()) * total;
    let pick: ItemType = items[0];
    for (const x of weighted) {
      acc -= x.w;
      if (acc <= 0) { pick = x.it; break; }
    }
    sfx.item();
    setItemFlash(true);
    setTimeout(() => setItemFlash(false), 1000);
    // 使い方設定に従ってスロットへ格納/発動する。
    const cat = ITEM_CAT[pick];
    const mode: UseMode = autoFullRef.current ? 'auto' : useModeRef.current[cat];
    const existing = slotsRef.current[cat];
    if (mode === 'instant') {
      sfx.use();
      applyItem(pick);
    } else if (mode === 'usenew') {
      if (existing) { sfx.use(); applyItem(pick); } // 既存を保持し、新着を発動
      else setSlot(cat, pick);
    } else {
      // hold / auto: スロットが埋まっていたら古い方を自動発動し、新着を保持。
      if (existing) applyItem(existing);
      setSlot(cat, pick);
    }
  }, [applyItem, bossMode, isBoss, selfMax, setSlot]);

  // オート発動: スロット別に「オート」設定（または完全オート）のアイテムを良い時に自動発動。
  useEffect(() => {
    if (!started || status !== 'playing') return;
    const id = setInterval(() => {
      if (!selfAliveRef.current) return;
      const frac = stateRef.current.backlog.length / selfMax; // 不利度
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
        if (frac >= 0.8) use = true;
        if (use) {
          sfx.use();
          applyItem(item);
          setSlot(cat, null);
        }
      }
    }, 700);
    return () => clearInterval(id);
  }, [started, status, applyItem, selfMax, setSlot]);

  // 指定スロットのアイテムを発動。
  const fireSlot = useCallback((cat: ItemCat) => {
    const item = slotsRef.current[cat];
    if (!item) return;
    sfx.use();
    applyItem(item);
    setSlot(cat, null);
  }, [applyItem, setSlot]);
  const fireSelected = useCallback(() => { fireSlot(selectedSlotRef.current); }, [fireSlot]);
  const cycleSlot = useCallback(() => {
    setSelectedSlot((c) => CAT_ORDER[(CAT_ORDER.indexOf(c) + 1) % CAT_ORDER.length]);
  }, []);

  const cycleTargetMode = useCallback(() => {
    setTargetMode((m) => {
      const idx = TARGET_MODES.findIndex((t) => t.mode === m);
      return TARGET_MODES[(idx + 1) % TARGET_MODES.length].mode;
    });
  }, []);

  // 受信した攻撃を予告ゲージへ。直近の攻撃者を記録（反撃ターゲット用）。
  useEffect(() => {
    if (!started) return;
    const unsub = subscribeAttacks(roomId, uid, (ev) => {
      // 視認性低下: おじゃまではなく自分の画面をゲーミング化する演出デバフ。
      if (ev.fx === 'dazzle') {
        setDazzleUntil(Date.now() + DAZZLE_DURATION);
        const fromName = playersRef.current[ev.from]?.name || '相手';
        pushToast(`${fromName} に視認性低下🌈をかけられた！`, 'in');
        if (ev.from) { lastAttackerRef.current = ev.from; fireIncoming(ev.from); }
        return;
      }
      // フリーズ中に来た攻撃は無効化（予告に積まず破棄）。解除後にまとめて来ない。
      if (Date.now() < freezeUntilRef.current) {
        const fromName = playersRef.current[ev.from]?.name || '相手';
        pushToast(`フリーズで ${fromName} の攻撃を無効化`, 'item');
        return;
      }
      // リフレクト中は、来た攻撃を送り主へそのまま跳ね返す。
      if (Date.now() < reflectUntilRef.current && ev.from && isLive(playersRef.current[ev.from] ?? ({} as RoomPlayer))) {
        sendAttack(roomId, ev.from, uid, ev.amount, ev.word);
        fireBeam(ev.from);
        pushToast(`リフレクト！ ${playersRef.current[ev.from]?.name || '相手'} へ跳ね返し`, 'item');
        return;
      }
      if (ev.from) {
        lastAttackerRef.current = ev.from;
        fireIncoming(ev.from);
      }
      const fromName = playersRef.current[ev.from]?.name || '相手';
      pushToast(ev.word ? `${fromName} から長文 📨` : `${fromName} から攻撃 +${ev.amount}`, 'in');
      updatePending([
        ...pendingRef.current,
        { id: ev.id, amount: ev.amount, confirmAt: Date.now() + TELEGRAPH_DELAY, word: ev.word },
      ]);
    });
    return () => unsub();
  }, [started, roomId, uid, updatePending, pushToast, fireIncoming]);

  // 迎撃: 相殺可能な予告が来ているのに山が空＝何もできず暇、を解消する。
  // 山が空のあいだ迎撃用の短いお題を供給し、打ち切れば1つ相殺できる（速い人ほど多く防げる）。
  // 迎撃ワードはローカル生成（Math.random）なので共有シードを消費せず、お題の同期は崩れない。
  useEffect(() => {
    if (!started || status !== 'playing' || !selfAlive || backlog.length > 0) return;
    const cancelable = pending.some((e) => !e.word && e.amount > 0);
    if (cancelable) setBacklog([makeShortWord('normal', categoryRef.current)]);
  }, [pending, backlog, started, status, selfAlive]);

  // 予告ゲージの確定処理。
  useEffect(() => {
    if (!started || status !== 'playing') return; // 決着後は着弾処理を止める
    const id = setInterval(() => {
      if (!selfAliveRef.current || pendingRef.current.length === 0) return;
      const now = Date.now();
      if (now < freezeUntilRef.current) return; // フリーズ中は確定を保留
      const due = pendingRef.current.filter((e) => e.confirmAt <= now);
      if (due.length === 0) return;
      updatePending(pendingRef.current.filter((e) => e.confirmAt > now));
      // 受け流し中は、確定したおじゃまを自分に入れず、別の“プレイヤー”へ逸らす。
      if (now < parryUntilRef.current) {
        let deflect = 0;
        for (const e of due) deflect += e.word ? 2 : e.amount;
        if (deflect > 0) {
          const targetId = pickTarget();
          if (targetId) {
            sendAttack(roomId, targetId, uid, deflect);
            fireBeam(targetId);
            const name = playersRef.current[targetId]?.name || '相手';
            pushToast(`受け流し！ ${name} へ +${deflect}`, 'item');
          } else {
            pushToast(`受け流し！ +${deflect}`, 'item');
          }
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
        else for (let i = 0; i < e.amount; i++) words.push(makeOjamaWord(categoryRef.current));
      }
      if (words.length > 0) {
        sfx.damage(); // 被弾SE（おじゃまが実際にバックログへ入った瞬間）
        setBacklog((prev) => {
          const next = [...prev, ...words];
          if (next.length > selfMax) {
            topOut();
            return next.slice(0, selfMax);
          }
          return next;
        });
      }
    }, 100);
    return () => clearInterval(id);
  }, [started, status, updatePending, topOut, pickTarget, roomId, uid, fireBeam, pushToast, selfMax]);

  // カウントダウン描画用の時刻ティック。
  useEffect(() => {
    if (!started) return;
    const id = setInterval(() => setNowTick(Date.now()), 150);
    return () => clearInterval(id);
  }, [started]);

  // 入力処理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (settingsOpenRef.current) return; // 設定モーダル表示中はゲーム操作を受け付けない
      resumeAudio();
      if (!started || !selfAliveRef.current) return;
      // キーコンフィグ(code)に従ってアイテム操作・ターゲット切替。
      const kc = keyConfigRef.current;
      if (e.code === 'Tab') { e.preventDefault(); return; } // ソロのリスタート用キー。対戦中は無効
      if (e.code === kc.target) { e.preventDefault(); cycleTargetMode(); return; }
      if (kc.inputMode === 'cycle') {
        if (e.code === kc.cycle) { e.preventDefault(); cycleSlot(); return; }
        if (e.code === kc.fire) { e.preventDefault(); fireSelected(); return; }
      } else {
        let handled = false;
        for (const cat of CAT_ORDER) {
          if (e.code === kc.slots[cat]) { e.preventDefault(); fireSlot(cat); handled = true; break; }
        }
        if (handled) return;
      }
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      const result = processKey(e.key.toLowerCase(), stateRef.current);
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
        setKeysTyped((k) => k + 1);
        if (result.clearedType === 'treasure') sfx.treasure(); else sfx.clear();
        // クリア演出: お題カード中心からリング／お宝は金スパーク／連鎖節目はバースト＋リング＋上昇音。
        const cardR = centerRef.current?.getBoundingClientRect();
        const cx = cardR ? cardR.left + cardR.width / 2 : window.innerWidth / 2;
        const cy = cardR ? cardR.top + cardR.height * 0.42 : window.innerHeight / 2;
        if (result.clearedType === 'treasure') addBurst(cx, cy, 'var(--charge)');
        else addRing(cx, cy, 'var(--primary)', 70);
        if (newCombo > 0 && newCombo % cStep === 0) {
          const tier = Math.floor(newCombo / cStep) - 1;
          sfx.combo(tier);
          addBurst(cx, cy, 'var(--charge)', tier >= 2);
          addRing(cx, cy, 'var(--charge)', 120 + tier * 24);
        }
        // 1単語クリアごとに、来ている着弾予告を1つ相殺（タイピング＝防御）。
        offsetIncoming(1);
        // ゲージはミスでは減らない。加算方式は「ワード数」=1 /「文字数」=クリア語の読み文字数。
        const clearedWord = stateRef.current.backlog[0];
        const charMode = gMode === 'char';
        const baseInc = charMode ? (clearedWord?.reading.length || 1) : 1;
        const inc = baseInc * (Date.now() < overchargeUntilRef.current ? 2 : 1); // オーバーチャージ中は倍速
        const gaugeThr = charMode ? gChars : atkGauge;
        attackProgressRef.current += inc;
        while (attackProgressRef.current >= gaugeThr) {
          attackProgressRef.current -= gaugeThr;
          launchAttack(newCombo);
        }
        setAttackProgress(attackProgressRef.current);
        if (Date.now() < rapidUntilRef.current) sendAmount(1); // 連射: 1クリアごとに1攻撃
        if (result.clearedType === 'treasure') grantItem();
      } else if (result.nextState) {
        setTokenIndex(result.nextState.tokenIndex);
        setCurrentTyping(result.nextState.currentTyping);
        if (result.typed) setTypedRomaji((tr) => { const n = [...tr]; for (const x of result.typed!) n[x.index] = x.romaji; return n; });
        setKeysTyped((k) => k + 1);
        sfx.type();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [started, launchAttack, sendAmount, fireSelected, cycleSlot, fireSlot, grantItem, cycleTargetMode, offsetIncoming, addBurst, addRing]);

  // ベース供給＆加速ループ（フリーズ/超シールド/シールド対応）。
  useEffect(() => {
    if (!started || !selfAlive || status !== 'playing') return; // 決着後は供給を止める
    let timerId: ReturnType<typeof setTimeout>;
    const loop = () => {
      const now = Date.now();
      if (now < freezeUntilRef.current) {
        /* フリーズ中は供給停止 */
      } else if (guardCountRef.current > 0) {
        guardCountRef.current -= 1; // ガード: 複数回ぶん供給を無効化
      } else if (shieldRef.current) {
        shieldRef.current = false;
      } else {
        setBacklog((prev) => {
          if (prev.length >= selfMax) {
            topOut();
            return prev;
          }
          return wordRngRef.current ? [...prev, genWord()] : prev;
        });
      }
      setSpawnInterval((prev) => Math.max(MIN_SPAWN_INTERVAL, prev * 0.98));
      timerId = setTimeout(loop, spawnInterval);
    };
    timerId = setTimeout(loop, spawnInterval);
    return () => clearTimeout(timerId);
  }, [started, selfAlive, spawnInterval, topOut, selfMax, status, genWord]);

  // サマリのスロットリング書込（バッジ＋観戦用の現在ワード/入力進捗も反映）。
  const summaryRef = useRef<Parameters<typeof writePlayerSummary>[2]>({ backlog: 0, combo: 0, kpm: 0, badges: 0 });
  {
    // 観戦表示用に、現在ワードの全ローマ字と確定済み文字数を計算する。
    // 入力中トークンは「打鍵中の文字列に合う綴り」を選ぶ（CurrentWord と同じ挙動）。
    const cur = backlog[0];
    const tokens = cur?.tokens ?? [];
    const parts = tokens.map((t, i) =>
      i < tokenIndex
        ? (typedRomaji[i] ?? t.romaji[0])
        : i === tokenIndex
          ? (t.romaji.find((r) => r.startsWith(currentTyping)) || t.romaji[0])
          : t.romaji[0],
    );
    const curRomaji = parts.join('');
    const curRomajiDone = parts.slice(0, tokenIndex).reduce((s, r) => s + r.length, 0) + currentTyping.length;
    summaryRef.current = {
      backlog: backlog.length, combo, kpm: calculateKPM(), kps: calculateKPS(), keys: keysTyped, badges: myBadges,
      // 山または着弾予告に長文(相殺不可)を抱えているか → 長文の重ねがけ防止に使う
      hasLong: backlog.some((w) => w.type === 'ojama' && w.reading.length >= 10)
        || pendingRef.current.some((e) => !!e.word),
      curDisplay: cur?.display ?? '', curReading: cur?.reading ?? '',
      curIdx: tokenIndex, curTyping: currentTyping, curRomaji, curRomajiDone,
    };
  }
  useEffect(() => {
    if (!started) return;
    const id = setInterval(() => {
      if (!selfAliveRef.current) return;
      writePlayerSummary(roomId, uid, summaryRef.current);
    }, WRITE_INTERVAL);
    return () => clearInterval(id);
  }, [started, roomId, uid]);

  // ホスト: 生存者が1人以下になったら決着へ。
  // started（カウントダウン後）になってから判定する。開始直後は各自の alive 再設定が
  // 伝播しておらず、判定すると即終了→再戦できない不具合になるため。
  useEffect(() => {
    if (uid !== hostUid || status !== 'playing' || !started) return;
    if (bossMode) {
      // ボス討伐 or 挑戦者全滅で決着。
      const boss = players[bossUid];
      const bossDead = !boss || !isLive(boss);
      const aliveChallengers = Object.entries(players).filter(([id, p]) => id !== bossUid && isLive(p)).length;
      const challengerTotal = Object.keys(players).filter((id) => id !== bossUid).length;
      if (bossDead || (challengerTotal >= 1 && aliveChallengers === 0)) finishGame(roomId);
      return;
    }
    const total = Object.keys(players).length;
    const aliveCount = Object.values(players).filter(isLive).length;
    // 全滅(=1人プレイのトップアウト)か、2人以上で残り1人になったら決着。
    if (aliveCount === 0 || (total >= 2 && aliveCount <= 1)) finishGame(roomId);
  }, [players, status, uid, hostUid, roomId, started, bossMode, bossUid]);

  // ホスト: CPU（擬似プレイヤー）をシミュレートする。動きはソロと同じ lib/cpu.ts
  // （打つ速さを持ったプレイヤー。人と同じペースで単語が積まれ、遅いCPUから脱落する）。
  // 以前は片付ける速さを「1秒あたりの語数」で持ちながら KPS として扱っていて（強さ5で約1.9語/秒＝
  // 人なら17打/秒相当）、連鎖も切れなかったため、CPU がほぼ倒せなかった。
  // CPUごとの盤面・攻撃の送受信・撃破・サマリ書込みを host が代行する。
  useEffect(() => {
    if (uid !== hostUid || !started || status !== 'playing') return;
    const cpuIds = Object.entries(playersRef.current).filter(([, p]) => p.isCpu).map(([id]) => id);
    if (cpuIds.length === 0) return;
    const cpuMax = playerHp;
    const baseSpawn = typeof spawnMs === 'number' ? spawnMs : INITIAL_SPAWN_INTERVAL;
    const attackOpts = { attackEvery: atkGauge, comboStep: cStep, attackCap: Math.min(atkCap, 3) };
    // 初期化（新規ゲームのたびに alive を立て直す）。強さは部屋で決めた値そのまま（ばらつかせない）。
    for (const id of cpuIds) {
      const d = makeCpu(0, id, playersRef.current[id]?.str ?? 0.5, Math.random, 0);
      cpuSimRef.current[id] = { d: { ...d, height: 3 }, rank: 0, koBy: '' };
      writePlayerSummary(roomId, id, { alive: true, rank: 0, backlog: 3, combo: 0, koBy: '', kpm: 0 });
    }
    // 被弾の購読（CPUごと）。脱落の判定は次の1秒の stepCpu で行う。
    const unsubs = cpuIds.map((id) =>
      subscribeAttacks(roomId, id, (ev) => {
        const s = cpuSimRef.current[id];
        if (!s || s.d.isKO) return;
        s.d = { ...s.d, height: s.d.height + (ev.word ? 2 : ev.amount) };
        if (ev.from) s.koBy = ev.from;
      }),
    );
    const tick = () => {
      const elapsedMs = Math.max(0, Date.now() - startTimeRef.current);
      // 人と同じ供給ペース（1語ごとに間隔×0.98 ＝ 経過時間に対してほぼ直線で短くなる）。
      const spawnMsNow = Math.max(MIN_SPAWN_INTERVAL, baseSpawn - 0.02 * elapsedMs);
      for (const id of cpuIds) {
        const s = cpuSimRef.current[id];
        if (!s || s.d.isKO) continue;
        const step = stepCpu(s.d, 1000 / spawnMsNow, cpuMax, Math.random, attackOpts);
        s.d = step.next;
        for (const amt of step.attacks) {
          const targets = Object.entries(playersRef.current).filter(([tid, tp]) => tid !== id && isLive(tp));
          if (targets.length === 0) break;
          const t = targets[Math.floor(Math.random() * targets.length)];
          // アイテムON時は低確率でCPUもアイテムを使用（無効化アイテムは送らない）。
          const canDazzle = itemsOnRef.current && !disabledItemsRef.current.has('dazzle');
          if (canDazzle && Math.random() < 0.06) sendAttack(roomId, t[0], id, 0, undefined, 'dazzle'); // 視認性低下
          else sendAttack(roomId, t[0], id, amt);
        }
        // ランキング表示用の KPS・総打鍵・総合スコア（人と同じ計算式。速さから合成）。
        const str = s.d.str ?? 0.5;
        const seconds = Math.max(1, elapsedMs / 1000);
        const kps = Math.round(cpuKps(str) * 10) / 10;
        const keys = Math.round(kps * seconds);
        const acc = Math.min(1, 0.9 + str * 0.08);
        const score = computeScore({ keys, miss: Math.round(keys * (1 - acc)), seconds, maxCombo: s.d.combo ?? 0 });
        const stats = { kpm: Math.round(kps * 60), kps, keys, acc, score };
        if (s.d.isKO) {
          const aliveCount = Object.values(playersRef.current).filter(isLive).length;
          s.rank = Math.max(1, aliveCount);
          writePlayerSummary(roomId, id, { alive: false, rank: s.rank, backlog: cpuMax, combo: 0, koBy: s.koBy, ...stats });
          continue;
        }
        writePlayerSummary(roomId, id, {
          alive: true, backlog: s.d.height, combo: s.d.combo ?? 0, ...stats,
          curDisplay: '🤖', curReading: '', curIdx: 0, curTyping: '',
        });
      }
    };
    const interval = setInterval(tick, 1000);
    return () => {
      clearInterval(interval);
      unsubs.forEach((u) => u());
    };
  }, [uid, hostUid, started, status, roomId, playerHp, spawnMs, atkGauge, atkCap, cStep]);

  // テトリス99のように、自分以外の攻防もアンビエントなビームで可視化する。
  // 実データの全攻撃は購読していないため、それっぽいビームを散らす表現。
  // ボス戦では挑戦者同士は撃ち合わない（全員ボスを攻撃する）ので、
  // 挑戦者 → ボス へ集まるビームを描く。
  useEffect(() => {
    if (!started || status !== 'playing') return;
    const id = setInterval(() => {
      if (Math.random() > 0.6) return;
      if (bossMode) {
        const boss = playersRef.current[bossUid];
        if (!boss || !isLive(boss)) return;
        // 挑戦者（自分とボス以外）から1人選び、ボスへビームを飛ばす。
        const challengers = Object.entries(playersRef.current).filter(([oid, p]) => oid !== bossUid && oid !== uid && isLive(p));
        if (challengers.length === 0) return;
        const a = challengers[Math.floor(Math.random() * challengers.length)];
        const from = boardRefs.current[a[0]]?.getBoundingClientRect();
        // ボスの盤面: 自分がボスなら中央、そうでなければボスのミニボード。
        const toRect = bossUid === uid ? centerRef.current?.getBoundingClientRect() : boardRefs.current[bossUid]?.getBoundingClientRect();
        if (from && toRect) {
          addBeam(from.left + from.width / 2, from.top + from.height / 2, toRect.left + toRect.width / 2, toRect.top + toRect.height / 2, '#94a3b8');
        }
        return;
      }
      const aliveOthers = Object.entries(playersRef.current).filter(([oid, p]) => oid !== uid && isLive(p));
      if (aliveOthers.length < 2) return;
      const a = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
      let b = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
      if (b[0] === a[0]) b = aliveOthers[(aliveOthers.indexOf(a) + 1) % aliveOthers.length];
      if (b[0] === a[0]) return;
      const from = boardRefs.current[a[0]]?.getBoundingClientRect();
      const to = boardRefs.current[b[0]]?.getBoundingClientRect();
      if (from && to) {
        addBeam(from.left + from.width / 2, from.top + from.height / 2, to.left + to.width / 2, to.top + to.height / 2, '#94a3b8');
      }
    }, 1300);
    return () => clearInterval(id);
  }, [started, status, uid, addBeam, bossMode, bossUid]);

  const others = Object.entries(players).filter(([id]) => id !== uid);
  // 両隣の相手グリッド: 各列で生存者を上（先頭）に詰め、脱落者を後ろへ送る（安定ソート）。
  const othersHalf = Math.ceil(others.length / 2);
  const packAliveEntries = (arr: [string, RoomPlayer][]) => [...arr].sort((a, b) => Number(!isLive(a[1])) - Number(!isLive(b[1])));
  const othersLeft = packAliveEntries(others.slice(0, othersHalf));
  const othersRight = packAliveEntries(others.slice(othersHalf));
  const aliveCount = Object.values(players).filter(isLive).length;
  const totalCount = Object.keys(players).length;
  const isDanger = backlog.length >= selfMax - 3;
  const totalIncoming = pending.reduce((s, e) => s + e.amount, 0);
  const isHost = uid === hostUid;
  // ボスモード: ボスのHP（バックログ）情報。
  const bossPlayer = bossMode ? players[bossUid] : undefined;
  const bossAlive = bossMode ? !!bossPlayer && isLive(bossPlayer) : false;
  const bossHp = bossPlayer ? Math.max(0, BOSS_MAX_BACKLOG - (bossPlayer.backlog || 0)) : 0;

  // 観戦: 脱落したら自分の入力画面を他プレイヤーの入力画面に切り替える。
  // 観戦対象が未選択/脱落した場合は、自分を倒した相手→先頭の生存者の順で自動選択。
  useEffect(() => {
    if (selfAlive || status !== 'playing') return;
    const aliveOthers = Object.entries(players).filter(([id, p]) => id !== uid && isLive(p));
    if (aliveOthers.length === 0) { if (watchId) setWatchId(null); return; }
    if (!watchId || !aliveOthers.some(([id]) => id === watchId)) {
      const koBy = lastAttackerRef.current;
      const pref = aliveOthers.find(([id]) => id === koBy) ?? aliveOthers[0];
      setWatchId(pref[0]);
    }
  }, [selfAlive, status, players, uid, watchId]);

  // 発動中の時間制限アイテム（残り時間カウントダウン表示用）。
  const activeEffects: { type: ItemType; until: number; color: string }[] = (
    [
      { type: 'rapid', until: rapidUntilRef.current, color: 'bg-yellow-400' },
      { type: 'keep', until: keepUntilRef.current, color: 'bg-fuchsia-500' },
      { type: 'parry', until: parryUntilRef.current, color: 'bg-violet-500' },
      { type: 'freeze', until: freezeUntilRef.current, color: 'bg-sky-400' },
      { type: 'reflect', until: reflectUntilRef.current, color: 'bg-pink-400' },
      { type: 'overcharge', until: overchargeUntilRef.current, color: 'bg-amber-400' },
      { type: 'siphon', until: siphonUntilRef.current, color: 'bg-rose-500' },
    ] as { type: ItemType; until: number; color: string }[]
  ).filter((e) => nowTick > 0 && e.until > nowTick);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setSfxEnabled(!next);
  };

  // 決着画面
  if (status === 'finished') {
    const ranked = Object.values(players).slice().sort((a, b) => {
      const ra = isLive(a) ? 0 : a.rank || 999;
      const rb = isLive(b) ? 0 : b.rank || 999;
      return ra - rb;
    });
    const winner = ranked.find(isLive) || ranked[0];
    const myIdx = ranked.findIndex((p) => p === players[uid]);
    const myRank = myIdx >= 0 ? myIdx + 1 : selfAlive ? 1 : rank;
    // ボスモードの勝敗判定。
    const bossWon = bossMode && bossAlive; // ボス生存＝ボスの勝ち
    const iWon = bossMode ? (isBoss ? bossWon : !bossWon) : myRank === 1;
    const meta = bossMode
      ? {
        tag: iWon ? 'VICTORY' : 'DEFEAT',
        title: bossWon ? `ボス ${bossPlayer?.name ?? ''} の勝ち（挑戦者は全滅）` : `討伐成功！ 挑戦者チームの勝ち（ボス: ${bossPlayer?.name ?? ''}）`,
        color: iWon ? 'var(--success)' : 'var(--incoming)',
        Icon: Crown,
      }
      : iWon
        ? { tag: 'VICTORY', title: `最後の1人まで勝ち残りました（${totalCount}人中）`, color: 'var(--success)', Icon: Crown }
        : { tag: 'RESULT', title: `勝者は ${winner?.name ?? '—'}`, color: 'rgb(var(--ac-300))', Icon: Trophy };
    // 総合スコア順位用の表示値（kps はフォールバックで kpm を使う）。
    const kpsOf = (p: RoomPlayer) => p.kps ?? p.kpm ?? 0;
    const list = resultTab === 'ko'
      ? Object.values(players).slice().sort((a, b) => (b.badges || 0) - (a.badges || 0) || kpsOf(b) - kpsOf(a))
      : resultTab === 'kpm'
        ? Object.values(players).slice().sort((a, b) => kpsOf(b) - kpsOf(a) || (b.badges || 0) - (a.badges || 0))
        : resultTab === 'score'
          ? Object.values(players).slice().sort((a, b) => (b.score || 0) - (a.score || 0) || kpsOf(b) - kpsOf(a))
          : ranked;
    const me = players[uid];
    const myScore = computeScore({ keys: keysTyped, miss: missCount, seconds: Math.max(0.1, ((endTimeRef.current || Date.now()) - startTimeRef.current) / 1000), maxCombo });
    const stats: [string, string | number][] = [
      ['総合スコア', myScore],
      ['KPS', calculateKPS().toFixed(1)],
      ['正確率', `${Math.round(accuracyOf(keysTyped, missCount) * 100)}%`],
      ['総打鍵', keysTyped],
      ['最大連鎖', maxCombo],
      ['撃破', myBadges],
    ];
    return (
      <div className="min-h-screen bg-transparent text-text flex flex-col">
        <div className="h-[3px] shrink-0" style={{ background: meta.color, boxShadow: `0 0 18px ${meta.color}` }} />
        <div className="w-full max-w-[1120px] mx-auto px-6 py-8 flex flex-col justify-center gap-5 flex-1">
          <header className="flex items-end justify-between gap-6 flex-wrap">
            <div>
              <div className="flex items-center gap-2 font-tech text-sm font-semibold tracking-[0.24em]" style={{ color: meta.color }}>
                <meta.Icon className="w-4 h-4" />{meta.tag}
              </div>
              <h2 className="text-[28px] leading-tight font-bold text-text mt-1.5 [text-wrap:balance]">{meta.title}</h2>
            </div>
            <div className="text-right leading-none">
              <div className="text-xs text-muted tracking-wide">あなたの順位</div>
              <div className="mt-1">
                <span className="font-tech text-[56px] font-bold tabular-nums text-text">{myRank}</span>
                <span className="text-lg font-bold text-text ml-1">位</span>
                <span className="text-sm text-muted ml-2">/ {totalCount}人中</span>
              </div>
            </div>
          </header>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] items-start">
            <section className="ui-panel p-5 min-w-0">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <h3 className="text-[15px] font-bold text-text">ランキング</h3>
                {/* 表示切替: 順位 / 総合スコア / 撃破 / KPS */}
                <div className="ui-seg ui-seg-sm" role="radiogroup" aria-label="ランキングの並べ方">
                  {([['rank', '順位'], ['score', '総合スコア'], ['ko', '撃破'], ['kpm', 'KPS']] as const).map(([k, lbl]) => (
                    <button key={k} type="button" role="radio" aria-checked={resultTab === k} data-on={resultTab === k}
                      onClick={() => setResultTab(k)} className="ui-seg-btn">
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <ol className="max-h-[50vh] overflow-y-auto">
                {list.map((p, i) => {
                  const mine = p === me;
                  const main = resultTab === 'ko' ? `${p.badges ?? 0}` : resultTab === 'kpm' ? kpsOf(p).toFixed(1) : `${p.score ?? 0}`;
                  const unit = resultTab === 'ko' ? '撃破' : resultTab === 'kpm' ? 'KPS' : '点';
                  return (
                    <li key={p.name + i} className="flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-lg border-t first:border-t-0"
                      style={{ borderColor: 'var(--line)', background: mine ? 'rgb(var(--ac-400) / 0.1)' : undefined }}>
                      <span className="font-tech text-sm tabular-nums text-muted w-7 shrink-0">#{i + 1}</span>
                      {/* 王冠は並べ方に関係なく、実際の勝者（ボス戦は勝った側の代表）にだけ付ける */}
                      {p === winner && <Crown className="w-4 h-4 shrink-0" style={{ color: 'var(--charge)' }} aria-label="勝者" />}
                      <span className={`truncate text-[15px] ${mine ? 'font-bold text-text' : 'text-text'}`}>{p.name}</span>
                      {mine && <span className="text-xs text-muted shrink-0">あなた</span>}
                      <span className="ml-auto text-right shrink-0">
                        <span className="font-tech text-lg font-semibold tabular-nums text-text">{main}</span>
                        <span className="text-xs text-muted ml-1">{unit}</span>
                        <span className="block text-xs text-muted tabular-nums">
                          {resultTab === 'score' || resultTab === 'rank' ? `${p.keys ?? 0}打 · ${kpsOf(p).toFixed(1)} KPS · 撃破${p.badges ?? 0}` : `${p.score ?? 0}点`}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>

            <section className="ui-panel p-5 grid grid-cols-2 gap-x-6 gap-y-5">
              {stats.map(([k, v]) => (
                <div key={k}>
                  <div className="text-xs text-muted tracking-wide">{k}</div>
                  <div className="font-tech text-[28px] font-semibold tabular-nums text-text leading-tight mt-0.5">{v}</div>
                </div>
              ))}
            </section>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {isHost ? (
              <button type="button" onClick={() => resetRoom(roomId)} className="ui-btn-primary h-12 px-7 text-base">
                <RotateCcw className="w-4 h-4" /> もう一度（同じメンバーで）
              </button>
            ) : (
              <div className="ui-panel h-12 px-5 flex items-center gap-2.5 text-sm text-muted">
                <Loader2 className="w-4 h-4 animate-spin text-primary" /> ホストの再戦を待っています…
              </div>
            )}
            <button type="button" onClick={onExit} className="ui-btn-secondary h-12 px-5 text-[15px]">
              <LogOut className="w-4 h-4" /> ロビーに戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  const word = backlog[0];

  return (
    <div className={`h-screen bg-transparent text-white font-sans overflow-hidden flex flex-col ${shake && keyCfg.screenShake ? 'screen-shake' : ''}`}>
      <div className={`fixed inset-0 pointer-events-none z-50 transition-colors duration-100 ${missFlash ? 'bg-red-500/20' : 'bg-transparent'}`} />
      {/* 視認性低下: 食らっている間は、お題パネルやゲージなど“実際の要素”を
          虹色＋ブレで歪ませて読みにくくする（フィルタは centerRef 等に適用）。 */}
      {dazzleUntil > nowTick && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[46] pointer-events-none text-xs font-black text-white bg-black/60 rounded-full px-3 py-1">
          🌈 視認性低下中… {Math.max(0, Math.ceil((dazzleUntil - nowTick) / 1000))}s
        </div>
      )}
      {/* 被弾時の赤フラッシュ（画面端を強く） */}
      <div
        className={`fixed inset-0 pointer-events-none z-40 transition-opacity duration-150 ${damageFlash ? 'opacity-100' : 'opacity-0'}`}
        style={{ boxShadow: 'inset 0 0 140px 40px rgba(239,68,68,0.55)' }}
      />

      {/* 受け流し成功エフェクト（シアンの衝撃波リング＋PARRY!） */}
      {parryFx && (
        <div className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center">
          <div className="parry-ring rounded-full border-4 border-cyan-300" />
          <div className="absolute parry-label text-4xl font-black italic text-cyan-200 drop-shadow-[0_0_18px_rgb(var(--ac-400)/0.9)]">
            PARRY!
          </div>
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

      {/* 撃破パーティクル（相手ボード中心から破片が放射） */}
      {bursts.map((bz) => (
        <div key={bz.id} className="fixed z-40 pointer-events-none tr-anim" style={{ left: bz.x, top: bz.y }}>
          {bz.parts.map((p, i) => (
            <span
              key={i}
              className="tr-burst absolute rounded-full"
              style={{ width: p.s, height: p.s, marginLeft: -p.s / 2, marginTop: -p.s / 2, background: bz.color, boxShadow: `0 0 6px ${bz.color}`, ['--dx']: `${p.dx}px`, ['--dy']: `${p.dy}px` } as React.CSSProperties}
            />
          ))}
        </div>
      ))}

      {/* 衝撃波リング */}
      {rings.map((rg) => (
        <div
          key={rg.id}
          className="fixed z-40 pointer-events-none tr-anim tr-ring rounded-full"
          style={{ left: rg.x, top: rg.y, width: rg.size, height: rg.size, marginLeft: -rg.size / 2, marginTop: -rg.size / 2, border: `3px solid ${rg.color}`, boxShadow: `0 0 16px ${rg.color}` }}
        />
      ))}

      {/* 自分のアイテム発動演出（名前＋ざっくり効果説明） */}
      {useFlash && (
        <div className="fixed top-[8.5rem] left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in zoom-in duration-200 flex flex-col items-center gap-1">
          <div className="bg-yellow-500/95 text-black font-black px-4 py-1.5 rounded-full flex items-center gap-2 shadow-lg">
            <span className="text-lg">{ITEM_EMOJI[useFlash]}</span> {ITEM_META[useFlash].name} 発動！
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
              <span className="text-2xl">{ITEM_EMOJI[boardFx]}</span>
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

      {!started && (
        <div className="fixed inset-0 flex flex-col items-center justify-center z-50" style={{ background: 'rgb(var(--n-950) / 0.92)', backdropFilter: 'blur(6px)' }} aria-live="assertive">
          <p className="ui-eyebrow">GET READY</p>
          <div
            key={countdown}
            className="tr-count font-tech font-bold leading-none mt-4"
            style={{ fontSize: 'clamp(96px, 14vw, 180px)', color: countdown > 0 ? 'var(--text)' : 'var(--primary)', textShadow: '0 0 40px var(--glow)' }}
          >
            {countdown > 0 ? countdown : 'GO'}
          </div>
          <p className="text-sm text-muted mt-6">全員同時にスタートします</p>
        </div>
      )}


      {!selfAlive && status === 'playing' && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 rounded-xl px-6 py-2.5 text-center"
          style={{ background: 'rgb(var(--n-950) / 0.92)', border: '1px solid var(--line)', boxShadow: 'inset 0 2px 0 var(--incoming)' }}>
          <div className="font-tech font-bold tracking-[0.12em] text-incoming">TOP OUT — {rank} 位</div>
          <div className="text-xs text-muted mt-0.5">観戦中。盤面をクリックすると観戦する相手を切り替えられます</div>
        </div>
      )}

      <header
        className="h-16 border-b flex items-center justify-between px-5 z-10"
        style={{ borderColor: 'var(--line)', background: 'rgb(var(--n-950) / 0.55)', backdropFilter: 'blur(8px)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Swords className="w-5 h-5 text-cyan-400 shrink-0" />
          <h1 className="font-tech text-lg font-bold tracking-[0.16em] text-text whitespace-nowrap">TYPE ROYALE</h1>
          <span className="font-tech text-xs font-semibold tracking-[0.2em] text-muted mt-0.5 whitespace-nowrap">
            {bossMode ? 'BOSS' : 'ONLINE'} · ROOM {roomId}
          </span>
          {isBoss && (
            <span className="flex items-center gap-1 text-xs font-semibold rounded-full px-2.5 py-0.5 whitespace-nowrap"
              style={{ color: 'var(--charge)', background: 'rgb(255 171 46 / 0.12)' }}>
              <Crown className="w-3.5 h-3.5" /> あなたがボス
            </span>
          )}
        </div>
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-6 pr-5 border-r" style={{ borderColor: 'var(--line)' }}>
            <Hud label="KPS" value={calculateKPS().toFixed(1)} />
            <Hud label="総打鍵" value={keysTyped} />
            <Hud label="バッジ" value={myBadges} />
          </div>
          <div className="flex items-center gap-1">
            <IconBtn label={muted ? '効果音をオンにする' : '効果音をオフにする'} onClick={toggleMute}>
              {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </IconBtn>
            <IconBtn label="プレイヤー設定（キー・テーマ）" onClick={() => setShowSettings(true)}><Settings className="w-5 h-5" /></IconBtn>
          </div>
        </div>
      </header>

      <main
        className="flex-1 min-h-0 flex w-full px-3 py-4 gap-3 h-[calc(100vh-4rem)]"
        style={{ transform: hitStop && keyCfg.screenShake ? 'scale(1.015)' : 'scale(1)', transition: 'transform 90ms ease-out' }}
      >
        <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2 content-start">
          {othersLeft.map(([id, p]) => (
            <div
              key={id}
              ref={(el) => { boardRefs.current[id] = el; }}
              onClick={() => { if (!selfAlive && isLive(p)) setWatchId(id); }}
              className={`${!selfAlive && isLive(p) ? 'cursor-pointer hover:opacity-80' : ''} ${watchId === id ? 'ring-2 ring-cyan-400 rounded-xl' : ''}`}
            >
              <MiniBoard
                height={p.backlog}
                max={bossMode && id === bossUid ? BOSS_MAX_BACKLOG : playerHp}
                isKO={!isLive(p)}
                name={bossMode && id === bossUid ? `👑 ${p.name}` : p.name}
                combo={p.combo}
                highlight={bossMode && id === bossUid}
                hit={hitId === id}
                incoming={incomingId === id}
                itemEmoji={p.itemAt && Date.now() - p.itemAt < 1500 ? ITEM_EMOJI[p.lastItem as ItemType] : undefined}
                bgImage={p.boardImg || undefined}
              />
            </div>
          ))}
        </div>

        <div ref={centerRef} className={`w-2/4 flex flex-col h-full min-h-0 relative ${dazzleUntil > nowTick ? 'dazzle-fx' : ''}`}>
          {isDanger && selfAlive && started && (
            <div className="absolute inset-0 rounded-2xl pointer-events-none animate-pulse z-0" style={{ boxShadow: 'inset 0 0 0 2px var(--incoming), inset 0 0 70px -10px rgb(255 77 94 / 0.35)' }} />
          )}
          {/* コンボ強度ビネット: 連鎖が伸びるほど内側発光が濃く・熱くなる（4連鎖以上で点灯） */}
          {selfAlive && started && combo >= 4 && (
            <div
              className="absolute inset-0 rounded-2xl pointer-events-none z-0 transition-[box-shadow] duration-200"
              style={{
                boxShadow: `inset 0 0 ${Math.min(30 + combo * 6, 130)}px ${Math.min(6 + combo * 1.4, 34)}px ${
                  combo >= 10 ? 'rgba(255,171,46,0.16)' : 'rgb(var(--ac-400)/0.13)'
                }`,
              }}
            />
          )}

          {/* 観戦オーバーレイ: 脱落したら中央の自分の入力画面を観戦相手の入力画面に置き換える。 */}
          {!selfAlive && status === 'playing' && (() => {
            const wp = watchId ? players[watchId] : undefined;
            if (!wp) return (
              <div className="absolute inset-0 z-30 flex items-center justify-center text-muted">観戦できるプレイヤーがいません</div>
            );
            const reading = wp.curReading ?? '';
            const idx = Math.min(wp.curIdx ?? 0, reading.length);
            const romaji = wp.curRomaji ?? '';
            const rdone = Math.min(wp.curRomajiDone ?? 0, romaji.length);
            const wpMax = bossMode && watchId === bossUid ? BOSS_MAX_BACKLOG : playerHp;
            return (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 rounded-2xl px-4" style={{ background: 'rgb(var(--n-950))' }}>
                <div className="text-sm font-semibold text-cyan-300 flex items-center gap-2"><Eye className="w-4 h-4" /> {wp.name} を観戦中</div>
                {/* 残りバックログ（HP）バー */}
                <div className="w-full max-w-xs">
                  <div className="flex justify-between text-xs text-muted mb-1.5">
                    <span className="font-tech tabular-nums">山 {wp.backlog} / {wpMax}</span>
                    <span className="font-tech tabular-nums">{wp.combo ?? 0} 連鎖 · {wp.kps ?? wp.kpm ?? 0} KPS</span>
                  </div>
                  <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: 'rgb(var(--n-50) / 0.06)' }}>
                    <div
                      className="h-full rounded-full transition-[width] duration-200"
                      style={{ width: `${Math.min(100, (wp.backlog / wpMax) * 100)}%`, background: wp.backlog >= wpMax - 3 ? 'var(--incoming)' : 'var(--backload)' }}
                    />
                  </div>
                </div>
                {/* 現在のワードと入力進捗（自分の盤面と同じく、ローマ字でどこまで打ったか表示）。
                    CPU は実際の単語を打たないので、入力の代わりに一言だけ出す。 */}
                {wp.isCpu ? (
                  <div className="tr-card w-full max-w-lg px-6 py-8 text-center text-sm text-muted">
                    CPU は単語を表示せずに戦っています（山の高さと連鎖で様子が分かります）
                  </div>
                ) : (
                <div className="tr-card w-full max-w-lg px-6 py-8 text-center">
                  <div className="text-4xl font-bold text-text mb-2 break-all">{wp.curDisplay || '—'}</div>
                  <div className="text-base font-mono2 tracking-wide mb-3">
                    <span className="text-muted opacity-60">{reading.slice(0, idx)}</span>
                    <span className="text-cyan-200">{reading.slice(idx)}</span>
                  </div>
                  {/* ローマ字の入力進捗（打った部分=緑／次の文字=ハイライト／未入力=灰）。
                      文字の横位置がズレないよう、カーソルは幅を持たせず背景ハイライトで表す。 */}
                  <div className="text-2xl font-mono2 tracking-wide break-all whitespace-pre-wrap">
                    {romaji.split('').map((ch, i) => (
                      <span
                        key={i}
                        className={
                          i < rdone
                            ? 'text-text'
                            : i === rdone
                              ? 'text-text bg-cyan-500/40 rounded-sm'
                              : 'text-muted'
                        }
                      >
                        {ch}
                      </span>
                    ))}
                  </div>
                </div>
                )}
                <div className="text-xs text-muted">ほかの盤面をクリックすると観戦する相手を切り替えられます</div>
              </div>
            );
          })()}
          <div className="flex-1 min-h-0 flex flex-col items-center pt-4 relative z-10">
            {/* ボスモードの状況表示（挑戦者にはボスHP、ボスには自分のHP）。 */}
            {/* ボス戦の状況（挑戦者だけ）。中央上は連鎖の大きな文字が出る場所なので避け、
                狙いの切替が無い挑戦者の左上に置く。ボス自身にはヘッダーに「あなたがボス」、HP は下の山の欄に出る。 */}
            {bossMode && started && !isBoss && (
                <div className="absolute top-1 left-0 z-20 w-40">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-semibold text-text flex items-center gap-1.5 min-w-0">
                      <Crown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--charge)' }} /> <span className="truncate">ボス {bossPlayer?.name ?? ''}</span>
                    </span>
                    <span className="font-tech tabular-nums text-muted shrink-0">HP {bossHp}/{BOSS_MAX_BACKLOG}</span>
                  </div>
                  <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: 'rgb(var(--n-50) / 0.06)' }}>
                    <div
                      className="h-full rounded-full transition-[width] duration-200"
                      style={{ width: `${(bossHp / BOSS_MAX_BACKLOG) * 100}%`, background: 'var(--incoming)' }}
                    />
                  </div>
                </div>
            )}

            {/* 狙いの切替（キーでも切替）。ボスモードの挑戦者は常にボスを狙うため非表示。 */}
            {!(bossMode && !isBoss) && (
              <div className="absolute top-1 left-0 z-20 flex flex-col items-start gap-1.5">
                <div className="flex items-center gap-1.5 text-xs text-muted"><Target className="w-3.5 h-3.5" /> 狙い <Kbd>{keyLabel(keyCfg.target)}</Kbd></div>
                {/* 背景を不透明に: 大きな連鎖表示が後ろに重なっても読める */}
                <div className="ui-seg ui-seg-sm" role="radiogroup" aria-label="狙う相手" style={{ background: 'rgb(var(--n-950) / 0.96)' }}>
                  {TARGET_MODES.map((t) => (
                    <button key={t.mode} type="button" role="radio" aria-checked={targetMode === t.mode} data-on={targetMode === t.mode}
                      onClick={() => setTargetMode(t.mode)} className="ui-seg-btn">
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 生存数（ソロと同じ：右上） */}
            <div className="absolute top-2 right-0 text-right leading-none">
              <div className="font-tech text-xs tracking-[0.16em] text-muted">生存</div>
              <div className="font-tech text-[30px] font-semibold tabular-nums text-text mt-1">
                {aliveCount}
                <span className="text-base text-muted"> / {totalCount}</span>
              </div>
            </div>

            {/* ログ（生存数の下・お題の右側の空白を使用）。上＝アイテム使用 / 中＝攻撃・撃破 / 下＝自分のアイテム */}
            <div className="absolute top-20 right-0 w-44 z-20 flex flex-col gap-3 pointer-events-none">
              {([
                ['アイテム', toasts.filter((t) => t.kind === 'item').slice(-4).map((t) => ({ id: t.id, text: t.text, color: 'var(--charge)', icon: <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--charge)' }} /> }))],
                ['攻撃・撃破', toasts.filter((t) => t.kind === 'ko' || t.kind === 'in').slice(-5).map((t) => ({
                  id: t.id, text: t.text,
                  color: t.kind === 'ko' ? 'rgb(var(--ac-400))' : 'var(--incoming)',
                  icon: t.kind === 'ko'
                    ? <Swords className="w-3.5 h-3.5 shrink-0 text-cyan-300" />
                    : <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--incoming)' }} />,
                }))],
              ] as const).map(([title, rows]) => rows.length > 0 && (
                <div key={title}>
                  <div className="text-xs text-muted mb-1 text-right">{title}</div>
                  <div className="flex flex-col gap-1 items-end">
                    {rows.map((r) => (
                      <div key={r.id} className="max-w-full flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-md text-xs font-medium text-text animate-in fade-in slide-in-from-right-2 duration-200"
                        style={{ background: 'rgb(var(--n-900) / 0.92)', boxShadow: `inset 2px 0 0 ${r.color}` }}>
                        {r.icon}<span className="truncate">{r.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {selfLog.length > 0 && (
                <div>
                  <div className="text-xs text-muted mb-1 text-right">自分のアイテム</div>
                  <div className="flex flex-col gap-1 items-end">
                    {selfLog.slice(-4).map((l) => (
                      <div key={l.id} className="max-w-full px-2.5 py-1.5 rounded-md text-xs text-text animate-in fade-in slide-in-from-right-2 duration-200"
                        style={{ background: 'rgb(var(--n-900) / 0.92)', boxShadow: 'inset 2px 0 0 rgb(var(--ac-400))' }}>
                        <div className="flex items-center gap-1.5 font-semibold"><span className="leading-none">{ITEM_EMOJI[l.item]}</span>{ITEM_META[l.item].name}</div>
                        <div className="text-muted leading-snug mt-0.5">{ITEM_META[l.item].desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>


            <div className="shrink-0 mb-3 text-center h-16 flex items-end justify-center">
              {combo > 2 && (
                <div
                  key={combo}
                  className="tr-combo-punch font-black italic flex items-center gap-2"
                  style={{
                    fontSize: `${Math.min(1.875 + (combo - 3) * 0.09, 3.4)}rem`,
                    color: combo >= 10 ? 'var(--charge)' : combo >= 6 ? '#ffd23e' : 'var(--primary)',
                    textShadow: `0 0 ${Math.min(10 + combo * 2, 44)}px ${combo >= 10 ? 'rgba(255,171,46,0.8)' : 'rgb(var(--ac-400)/0.7)'}`,
                  }}
                >
                  <Zap className="w-8 h-8" style={{ fill: 'currentColor' }} /> {combo} COMBO!
                </div>
              )}
            </div>

            {/* お題エリア（固定高さ）。お題の有無・長短や効果ゲージ増減でレイアウトが動かない。 */}
            <div className="shrink-0 h-2" />

            {/* 次のお題プレビュー（固定高さ）。直近の次のお題を常にお題カード直上（下端）に表示。 */}
            <div className="shrink-0 w-full max-w-lg h-14 flex flex-col justify-end gap-1 overflow-hidden mb-2">
              {backlog
                .slice(1, 3)
                .reverse()
                .map((w) => (
                  <div
                    key={w.id}
                    className="px-4 py-1.5 rounded-lg text-sm font-semibold flex justify-between items-center text-text"
                    style={{
                      background: 'rgb(var(--n-900) / 0.7)',
                      border: '1px solid var(--line)',
                      boxShadow: `inset 3px 0 0 ${w.type === 'ojama' ? 'var(--incoming)' : w.type === 'treasure' ? 'var(--charge)' : 'var(--backload)'}`,
                      opacity: 0.85,
                    }}
                  >
                    <span>{w.display}</span>
                    {w.type === 'ojama' && <AlertTriangle className="w-4 h-4" style={{ color: 'var(--incoming)' }} />}
                    {w.type === 'treasure' && <Sparkles className="w-4 h-4" style={{ color: 'var(--charge)' }} />}
                  </div>
                ))}
            </div>

            {/* お題カード（固定高さ・中央寄せ）。プレビューと同じ max-w-lg 中央寄せで横位置を揃える。
                着弾予告ゲージはカードの左隣に絶対配置し、カードの中央位置に影響させない。 */}
            <div className="shrink-0 w-full max-w-lg relative">
              {started && (
                <div className="absolute right-full top-1/2 -translate-y-1/2 mr-2 w-12 flex flex-col items-center gap-1 pointer-events-none">
                  <div className={`flex items-center gap-1 font-tech text-sm font-bold text-incoming mb-0.5 h-5 ${totalIncoming > 0 ? 'animate-pulse' : ''}`}>{totalIncoming > 0 && <><AlertTriangle className="w-4 h-4" />{totalIncoming}</>}</div>
                  <div className="w-6 flex flex-col-reverse gap-[3px]">
                    {Array.from({ length: Math.min(selfMax, 12) }).map((_, i) => {
                      const filled = i < Math.min(totalIncoming, 12);
                      return (
                        <div
                          key={i}
                          className="w-full h-[13px] rounded"
                          style={{
                            background: filled ? 'var(--incoming)' : 'var(--surface2)',
                            border: filled ? '1px solid var(--incoming)' : '1px solid var(--line)',
                            boxShadow: filled ? '0 0 7px var(--incoming)' : 'none',
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="text-xs text-muted text-center leading-tight mt-1">着弾<br />予告</div>
                </div>
              )}

              {/* お題カードの固定高さスロット（中央寄せ）。お題の有無や行数が変わっても高さ一定。
                  overflow-hidden で、万一カードが伸びても隣（次のお題・アイテムスロット）に被らせない。 */}
              <div className="h-56 flex items-stretch justify-center overflow-hidden">
                {/* 打ち切って山が空の間は、枠だけ出して次のお題を待つ（中央がぽっかり空いて見えないように） */}
                {!word && started && selfAlive && (
                  <div className="w-full h-full rounded-2xl flex items-center justify-center text-sm text-muted" style={{ border: '1px dashed var(--line)' }}>
                    次のお題を待っています…
                  </div>
                )}
                {word && (
                  <div
                    className="tr-card w-full h-full px-5 py-4 overflow-hidden flex flex-col justify-center"
                    style={{ borderColor: word.type === 'ojama' ? 'var(--incoming)' : word.type === 'treasure' ? 'var(--charge)' : undefined }}
                  >
                    <TrCorners color={word.type === 'ojama' ? 'var(--incoming)' : word.type === 'treasure' ? 'var(--charge)' : 'var(--primary)'} />
                    <div className="relative z-[2]">
                      <CurrentWord
                        word={word}
                        tokenIndex={tokenIndex}
                        currentTyping={currentTyping}
                        accent={word.type === 'ojama' ? 'text-incoming' : word.type === 'treasure' ? 'text-charge' : 'text-primary'}
                        typedRomaji={typedRomaji}
                        romajiVisible={keyCfg.romajiMode === 'always' || romajiHint}
                        readingMode={keyCfg.readingMode}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* グループ3: アイテムスロット〜アタックゲージ（画面下部に固定）。
                高さは常に一定なので、効果ゲージが何個出ても上のお題グループは動かない。
                お題パネルと間隔を空ける（mt-6）。 */}
            <div className="shrink-0 w-full flex flex-col items-center mt-6">
              {/* アイテムスロット（攻撃/防御/妨害）。入力方式で表示を切替。アイテムOFFなら非表示。 */}
              {itemsOn && (
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
                        className="min-w-[6.5rem] rounded-xl border px-3 py-1.5 flex flex-col items-center gap-0.5 transition-colors"
                        style={{
                          borderColor: sel ? 'rgb(var(--ac-400) / 0.7)' : 'var(--line)',
                          background: sel ? 'rgb(var(--ac-400) / 0.1)' : 'rgb(var(--n-900) / 0.7)',
                        }}
                      >
                        <span className="text-xs font-semibold text-muted flex items-center gap-1">
                          {c.label}
                          {direct && <Kbd>{keyLabel(keyCfg.slots[c.key])}</Kbd>}
                        </span>
                        {item ? (
                          <span className="flex items-center gap-1.5">
                            <ItemIcon type={item} />
                            <span className="text-sm font-semibold text-text">{ITEM_META[item].name}</span>
                          </span>
                        ) : (
                          <span className="text-sm text-muted opacity-60">空き</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="text-xs text-muted flex items-center gap-1.5 mt-0.5">
                  {keyCfg.inputMode === 'cycle' ? (
                    <>
                      <Kbd>{keyLabel(keyCfg.cycle)}</Kbd> 切替 <span className="opacity-50">・</span> <Kbd>{keyLabel(keyCfg.fire)}</Kbd> 発動
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
            {status === 'playing' && activeEffects.length > 0 && (
              <div className="w-full max-w-lg mt-3 flex flex-col gap-1">
                {activeEffects.map((e) => {
                  const dur = ITEM_DURATION[e.type] ?? 1;
                  const remain = Math.max(0, e.until - nowTick);
                  const frac = Math.max(0, Math.min(1, remain / dur));
                  return (
                    <div key={e.type} className="rounded-lg px-3 py-1 flex items-center gap-2" style={{ background: 'rgb(var(--n-900) / 0.85)', border: '1px solid var(--line)' }}>
                      <span className="text-base leading-none">{ITEM_EMOJI[e.type]}</span>
                      <span className="text-xs font-semibold text-text whitespace-nowrap w-24 shrink-0 truncate">{ITEM_META[e.type].name}</span>
                      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgb(var(--n-50) / 0.08)' }}>
                        <div className={`h-full ${e.color} transition-[width] duration-150`} style={{ width: `${frac * 100}%` }} />
                      </div>
                      <span className="font-tech text-xs font-semibold text-text tabular-nums w-10 text-right">
                        {(remain / 1000).toFixed(1)}<span className="text-muted">秒</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="w-full max-w-lg mt-4">
              <div className="flex justify-between text-xs text-muted mb-1.5">
                <span>{isBoss ? 'あなたの山（満タンで討伐される）' : '自分の山（満タンで脱落）'}</span>
                <span className={`font-tech tabular-nums ${isDanger ? 'text-incoming font-semibold' : ''}`}>{backlog.length} / {selfMax}</span>
              </div>
              <div className="flex gap-1">
                {Array.from({ length: selfMax }).map((_, i) => {
                  const filled = i < backlog.length;
                  const danger = i >= selfMax - 3;
                  return (
                    <div
                      key={i}
                      className="h-2.5 flex-1 rounded-[3px] transition-colors"
                      style={{ background: filled ? (danger ? 'var(--incoming)' : isBoss ? 'var(--charge)' : 'var(--backload)') : 'rgb(var(--n-50) / 0.06)' }}
                    />
                  );
                })}
              </div>
            </div>

            <div className="mt-3">
              <AttackGauge progress={attackProgress} combo={combo} pinch={isDanger} badges={myBadges} threshold={gMode === 'char' ? gChars : atkGauge} unit={gMode === 'char' ? '文字' : 'クリア'} />
            </div>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2 content-start">
          {othersRight.map(([id, p]) => (
            <div
              key={id}
              ref={(el) => { boardRefs.current[id] = el; }}
              onClick={() => { if (!selfAlive && isLive(p)) setWatchId(id); }}
              className={`${!selfAlive && isLive(p) ? 'cursor-pointer hover:opacity-80' : ''} ${watchId === id ? 'ring-2 ring-cyan-400 rounded-xl' : ''}`}
            >
              <MiniBoard
                height={p.backlog}
                max={bossMode && id === bossUid ? BOSS_MAX_BACKLOG : playerHp}
                isKO={!isLive(p)}
                name={bossMode && id === bossUid ? `👑 ${p.name}` : p.name}
                combo={p.combo}
                highlight={bossMode && id === bossUid}
                hit={hitId === id}
                incoming={incomingId === id}
                itemEmoji={p.itemAt && Date.now() - p.itemAt < 1500 ? ITEM_EMOJI[p.lastItem as ItemType] : undefined}
                bgImage={p.boardImg || undefined}
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
        @keyframes parryRing { 0% { width: 40px; height: 40px; opacity: 0.9; } 100% { width: 360px; height: 360px; opacity: 0; } }
        .parry-ring { width: 40px; height: 40px; animation: parryRing 0.5s ease-out forwards; box-shadow: 0 0 24px rgb(var(--ac-400)/0.8); }
        @keyframes parryLabel { 0% { transform: scale(0.6); opacity: 0; } 30% { transform: scale(1.1); opacity: 1; } 100% { transform: scale(1); opacity: 0; } }
        .parry-label { animation: parryLabel 0.5s ease-out forwards; }
        @keyframes boardFxBanner { 0% { transform: scale(0.6); opacity: 0; } 18% { transform: scale(1.12); opacity: 1; } 80% { transform: scale(1); opacity: 1; } 100% { transform: scale(1); opacity: 0; } }
        .board-fx-banner { animation: boardFxBanner 1.3s ease-out forwards; }
        @keyframes boardFxFlash { 0% { opacity: 0; } 15% { opacity: 1; } 100% { opacity: 0; } }
        .board-fx-flash { animation: boardFxFlash 1.3s ease-out forwards; }
        /* 視認性低下: 実際の要素(お題パネル/各ゲージ/文字)自体を虹色シフト＋ブレ＋
           過彩度で歪ませて読みにくくする。フラットなオーバーレイより視認性が大きく下がる。 */
        @keyframes dazzleFilter {
          0%   { filter: hue-rotate(0deg)   saturate(3) contrast(1.5) blur(1.3px); }
          100% { filter: hue-rotate(360deg) saturate(3) contrast(1.5) blur(1.3px); }
        }
        .dazzle-fx { animation: dazzleFilter 0.85s linear infinite; }
      `,
        }}
      />
    </div>
  );
}

