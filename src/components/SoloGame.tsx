import { useState, useEffect, useCallback, useRef } from 'react';
import { Swords, Zap, Trophy, Shield, AlertTriangle, Sparkles, Wind, Pause, ArrowLeft, Volume2, VolumeX, Bomb, Crown } from 'lucide-react';
import { mulberry32, randomSeed, type RNG } from '../lib/rng';
import { generateWord, THEMES } from '../lib/words';
import { processKey, type PlayerState } from '../lib/engine';
import { sfx, resumeAudio, setSfxEnabled } from '../lib/sfx';
import type { Dummy, GameStatus, ItemType } from '../lib/types';
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

const ITEM_META: Record<ItemType, { name: string; icon: string; desc: string }> = {
  shield: { name: 'シールド', icon: '🛡', desc: '次の自動供給を1回無効化' },
  clear: { name: 'おじゃま一掃', icon: '🌀', desc: 'バックログのおじゃまを消す' },
  brake: { name: 'ブレーキ', icon: '⏸', desc: '自動供給を5秒間ストップ' },
  longbomb: { name: 'ロング送信', icon: '📨', desc: '敵に長い単語(大ダメージ)を送る' },
  rapid: { name: '連射', icon: '⚡', desc: '8秒間 1連鎖ごとに1攻撃' },
};

export default function SoloGame({ onExit, custom = false }: { onExit: () => void; custom?: boolean }) {
  const [gameState, setGameState] = useState<GameStatus>('start');

  const [backlog, setBacklog] = useState<PlayerState['backlog']>([]);
  const [tokenIndex, setTokenIndex] = useState(0);
  const [currentTyping, setCurrentTyping] = useState('');
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [score, setScore] = useState(0);
  const [keysTyped, setKeysTyped] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [spawnInterval, setSpawnInterval] = useState(INITIAL_SPAWN_INTERVAL);
  const [seed, setSeed] = useState(0);

  const [playerKOs, setPlayerKOs] = useState(0);
  const [heldItem, setHeldItem] = useState<ItemType | null>(null);

  const [missFlash, setMissFlash] = useState(false);
  const [itemFlash, setItemFlash] = useState(false);
  const [attackFlash, setAttackFlash] = useState(0);
  const [hitDummy, setHitDummy] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [theme, setTheme] = useState('all');
  const [rapidActive, setRapidActive] = useState(false);
  // エフェクト用
  const [beams, setBeams] = useState<{ id: number; x1: number; y1: number; x2: number; y2: number; color: string }[]>([]);
  const [shake, setShake] = useState(false);
  const [useFlash, setUseFlash] = useState<ItemType | null>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const dummyRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const beamIdRef = useRef(0);
  const addBeam = useCallback((x1: number, y1: number, x2: number, y2: number, color: string) => {
    const id = beamIdRef.current++;
    setBeams((b) => [...b, { id, x1, y1, x2, y2, color }]);
    setTimeout(() => setBeams((b) => b.filter((x) => x.id !== id)), 700);
  }, []);
  // カスタムモードの設定
  const [cfgInitial, setCfgInitial] = useState(INITIAL_SPAWN_INTERVAL);
  const [cfgMin, setCfgMin] = useState(MIN_SPAWN_INTERVAL);
  const [cfgAccel, setCfgAccel] = useState(DEFAULT_ACCEL);
  const accelRef = useRef(DEFAULT_ACCEL);
  const minRef = useRef(MIN_SPAWN_INTERVAL);
  const rapidUntilRef = useRef(0);
  const themeRef = useRef(theme);
  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  const [dummies, setDummies] = useState<Dummy[]>(
    Array.from({ length: DUMMY_COUNT }).map((_, i) => ({ id: i, height: 0, isKO: false })),
  );

  const stateRef = useRef<PlayerState>({ backlog, tokenIndex, currentTyping, combo, gameState });
  useEffect(() => {
    stateRef.current = { backlog, tokenIndex, currentTyping, combo, gameState };
  }, [backlog, tokenIndex, currentTyping, combo, gameState]);

  const dummiesRef = useRef(dummies);
  useEffect(() => {
    dummiesRef.current = dummies;
  }, [dummies]);

  const heldItemRef = useRef(heldItem);
  useEffect(() => {
    heldItemRef.current = heldItem;
  }, [heldItem]);

  const wordRngRef = useRef<RNG | null>(null);
  const itemRngRef = useRef<RNG | null>(null);
  const shieldRef = useRef(false);
  const brakeUntilRef = useRef(0);

  const fireAttack = useCallback((amount: number) => {
    const alive = dummiesRef.current.filter((d) => !d.isKO);
    if (alive.length === 0) return;
    const target = alive[Math.floor(Math.random() * alive.length)];
    const willKO = target.height + amount > MAX_BACKLOG;
    setDummies((prev) =>
      prev.map((d) =>
        d.id === target.id ? (willKO ? { ...d, height: 0, isKO: true } : { ...d, height: d.height + amount }) : d,
      ),
    );
    if (willKO) {
      setPlayerKOs((k) => k + 1);
      sfx.ko();
    }
    sfx.attack();
    setAttackFlash(amount);
    setHitDummy(target.id);
    // 自分のボードから対象ダミーへビーム
    const from = centerRef.current?.getBoundingClientRect();
    const to = dummyRefs.current[target.id]?.getBoundingClientRect();
    if (from && to) {
      addBeam(from.left + from.width / 2, from.top + from.height * 0.35, to.left + to.width / 2, to.top + to.height / 2, '#fb923c');
    }
    setTimeout(() => setAttackFlash(0), 600);
    setTimeout(() => setHitDummy((cur) => (cur === target.id ? null : cur)), 600);
  }, [addBeam]);

  // アイテムの効果を適用（所持状態のクリアは行わない）。
  const applyItem = useCallback(
    (item: ItemType) => {
      setUseFlash(item);
      setTimeout(() => setUseFlash(null), 900);
      if (item === 'shield') shieldRef.current = true;
      else if (item === 'brake') brakeUntilRef.current = Date.now() + BRAKE_DURATION;
      else if (item === 'clear')
        setBacklog((prev) => (prev.length <= 1 ? prev : [prev[0], ...prev.slice(1).filter((w) => w.type !== 'ojama')]));
      else if (item === 'longbomb') fireAttack(6); // ソロでは敵ダミーへの大ダメージ攻撃
      else if (item === 'rapid') {
        rapidUntilRef.current = Date.now() + RAPID_DURATION;
        setRapidActive(true);
        setTimeout(() => setRapidActive(false), RAPID_DURATION);
      }
    },
    [fireAttack],
  );

  const grantItem = useCallback(() => {
    // 既にアイテムを持っていたら自動発動してから新規をスタックする。
    if (heldItemRef.current) applyItem(heldItemRef.current);
    const rng = itemRngRef.current;
    const items: ItemType[] = ['shield', 'clear', 'brake', 'longbomb', 'rapid'];
    const pick = rng ? items[Math.floor(rng() * items.length)] : items[0];
    setHeldItem(pick);
    sfx.item();
    setItemFlash(true);
    setTimeout(() => setItemFlash(false), 1000);
  }, [applyItem]);

  const useItem = useCallback(() => {
    const item = heldItemRef.current;
    if (!item) return;
    sfx.use();
    applyItem(item);
    setHeldItem(null);
  }, [applyItem]);

  const startGame = useCallback(() => {
    const newSeed = randomSeed();
    const wordRng = mulberry32(newSeed);
    const itemRng = mulberry32((newSeed ^ 0x9e3779b9) >>> 0);
    wordRngRef.current = wordRng;
    itemRngRef.current = itemRng;
    shieldRef.current = false;
    brakeUntilRef.current = 0;
    setSeed(newSeed);
    const th = themeRef.current;
    setBacklog([generateWord(wordRng, th), generateWord(wordRng, th), generateWord(wordRng, th)]);
    setTokenIndex(0);
    setCurrentTyping('');
    setCombo(0);
    setMaxCombo(0);
    setScore(0);
    setKeysTyped(0);
    setPlayerKOs(0);
    setHeldItem(null);
    setStartTime(Date.now());
    accelRef.current = custom ? cfgAccel : DEFAULT_ACCEL;
    minRef.current = custom ? cfgMin : MIN_SPAWN_INTERVAL;
    rapidUntilRef.current = 0;
    setRapidActive(false);
    setSpawnInterval(custom ? cfgInitial : INITIAL_SPAWN_INTERVAL);
    setGameState('playing');
    setDummies((prev) => prev.map((d) => ({ ...d, height: Math.floor(Math.random() * 5), isKO: false })));
    sfx.start();
  }, [custom, cfgInitial, cfgMin, cfgAccel]);

  const gameOver = useCallback(() => {
    setGameState('gameover');
    sfx.gameover();
    setShake(true);
    setTimeout(() => setShake(false), 450);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { gameState } = stateRef.current;
      resumeAudio();
      if ((gameState === 'start' || gameState === 'gameover' || gameState === 'win') && e.key === ' ') {
        e.preventDefault();
        startGame();
        return;
      }
      if (gameState === 'playing' && e.key === 'Enter') {
        e.preventDefault();
        useItem();
        return;
      }
      if (gameState !== 'playing' || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      const key = e.key.toLowerCase();
      const result = processKey(key, stateRef.current);

      if (result.miss) {
        setCombo(0);
        setMissFlash(true);
        sfx.miss();
        setTimeout(() => setMissFlash(false), 150);
      } else if (result.wordCleared && result.nextState) {
        const newCombo = result.nextState.combo;
        setBacklog(result.nextState.backlog);
        setTokenIndex(0);
        setCurrentTyping('');
        setCombo(newCombo);
        setMaxCombo((m) => Math.max(m, newCombo));
        setKeysTyped((prev) => prev + 1);
        setScore((s) => s + 100 + newCombo * 10);
        sfx.clear();
        if (newCombo >= 5 && newCombo % 5 === 0) fireAttack(Math.min(newCombo / 5, ATTACK_CAP));
        if (Date.now() < rapidUntilRef.current) fireAttack(1); // 連射: 1連鎖ごとに1攻撃
        if (result.clearedType === 'treasure') grantItem();
      } else if (result.nextState) {
        setTokenIndex(result.nextState.tokenIndex);
        setCurrentTyping(result.nextState.currentTyping);
        setKeysTyped((prev) => prev + 1);
        sfx.type();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [startGame, useItem, fireAttack, grantItem]);

  useEffect(() => {
    if (gameState !== 'playing') return;
    const interval = setInterval(() => {
      setDummies((prev) =>
        prev.map((d) => {
          if (d.isKO) return d;
          // やや上昇寄りのランダムウォーク（最終的に脱落＝倒せる余地を作る）
          let newHeight = d.height + (Math.random() > 0.45 ? 1 : -1);
          if (newHeight < 0) newHeight = 0;
          if (newHeight > MAX_BACKLOG) {
            sfx.eliminate();
            return { ...d, height: 0, isKO: true };
          }
          return { ...d, height: newHeight };
        }),
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [gameState]);

  // 全ダミーを倒したら勝利（ソロの勝利条件）。
  useEffect(() => {
    if (gameState !== 'playing') return;
    if (dummies.length > 0 && dummies.every((d) => d.isKO)) {
      setGameState('win');
      sfx.start();
    }
  }, [dummies, gameState]);

  useEffect(() => {
    if (gameState !== 'playing') return;
    let timerId: ReturnType<typeof setTimeout>;
    const loop = () => {
      const now = Date.now();
      if (now < brakeUntilRef.current) {
        // ブレーキ中
      } else if (shieldRef.current) {
        shieldRef.current = false;
      } else {
        setBacklog((prev) => {
          if (prev.length >= MAX_BACKLOG) {
            gameOver();
            return prev;
          }
          const rng = wordRngRef.current;
          return rng ? [...prev, generateWord(rng, themeRef.current)] : prev;
        });
      }
      setSpawnInterval((prev) => Math.max(minRef.current, prev * accelRef.current));
      timerId = setTimeout(loop, spawnInterval);
    };
    timerId = setTimeout(loop, spawnInterval);
    return () => clearTimeout(timerId);
  }, [gameState, spawnInterval, gameOver]);

  const calculateKPM = () => {
    if (!startTime || keysTyped === 0) return 0;
    return Math.floor(keysTyped / ((Date.now() - startTime) / 60000));
  };

  const renderCurrentWord = () => {
    if (backlog.length === 0) return null;
    const word = backlog[0];
    const isOjama = word.type === 'ojama';
    const isTreasure = word.type === 'treasure';
    return (
      <div
        className={`p-6 rounded-xl border-2 shadow-2xl mb-4 transition-all duration-200 ${
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
        />
      </div>
    );
  };

  const isDanger = backlog.length >= MAX_BACKLOG - 3;
  const eliminatedCount = dummies.filter((d) => d.isKO).length;
  const survivors = DUMMY_COUNT + 1 - eliminatedCount;

  return (
    <div className={`min-h-screen bg-neutral-950 text-white font-sans overflow-hidden flex flex-col selection:bg-cyan-900 ${shake ? 'screen-shake' : ''}`}>
      <div className={`fixed inset-0 pointer-events-none z-50 transition-colors duration-100 ${missFlash ? 'bg-red-500/20' : 'bg-transparent'}`} />

      {/* 攻撃ビーム（自分→対象ダミー） */}
      {beams.length > 0 && (
        <svg className="fixed inset-0 w-full h-full pointer-events-none z-40">
          {beams.map((b) => (
            <g key={b.id} className="attack-beam">
              <line x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} stroke={b.color} strokeWidth={4} strokeLinecap="round" />
              <circle cx={b.x2} cy={b.y2} r={14} fill="none" stroke={b.color} strokeWidth={3} />
              <circle cx={b.x1} cy={b.y1} r={5} fill={b.color} />
            </g>
          ))}
        </svg>
      )}

      {/* アイテム発動演出 */}
      {useFlash && (
        <div className="fixed top-[8rem] left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in zoom-in duration-200">
          <div className="bg-yellow-500/95 text-black font-black px-4 py-1.5 rounded-full flex items-center gap-2 shadow-lg">
            <span className="text-lg">{ITEM_META[useFlash].icon}</span> {ITEM_META[useFlash].name} 発動！
          </div>
        </div>
      )}

      {/* 演出は上部に出して、打つべき単語に被らないようにする */}
      {attackFlash > 0 && (
        <div className="fixed top-[4.5rem] left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="text-3xl font-black italic text-orange-400 drop-shadow-[0_0_15px_rgba(251,146,60,0.8)] flex items-center gap-2">
            <Swords className="w-7 h-7" /> ATTACK ×{attackFlash}!
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
            TYPE ROYALE<span className="text-xs ml-2 text-gray-500">{custom ? 'CUSTOM' : 'SOLO'}</span>
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
        </div>
      </header>

      <main className="flex-1 flex w-full max-w-7xl mx-auto p-4 gap-4 h-[calc(100vh-4rem)]">
        <div className="w-1/4 grid grid-cols-2 gap-2 content-start">
          {dummies.slice(0, 10).map((d) => (
            <div key={d.id} ref={(el) => { dummyRefs.current[d.id] = el; }}>
              <MiniBoard height={d.height} max={MAX_BACKLOG} isKO={d.isKO} hit={hitDummy === d.id} />
            </div>
          ))}
        </div>

        <div ref={centerRef} className="w-2/4 flex flex-col h-full relative">
          {isDanger && gameState === 'playing' && (
            <div className="absolute inset-0 border-4 border-red-500/50 rounded-2xl pointer-events-none animate-pulse z-0" />
          )}

          <div className="flex-1 flex flex-col items-center justify-end pb-8 relative z-10">
            {rapidActive && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-yellow-500/90 text-black text-xs font-black px-3 py-1 rounded-full flex items-center gap-1 animate-pulse">
                <Zap className="w-4 h-4" /> 連射中！
              </div>
            )}
            {gameState === 'playing' && (
              <div className="absolute top-2 right-0 text-right">
                <div className="text-xs text-gray-500">ALIVE</div>
                <div className="font-mono text-2xl font-bold text-gray-300">
                  {survivors}
                  <span className="text-sm text-gray-600"> / {DUMMY_COUNT + 1}</span>
                </div>
              </div>
            )}

            {/* 自分のバックログ（処理待ちの山）。満タンでトップアウト＝敗北。 */}
            <div className="absolute left-0 bottom-8 top-1/4 flex flex-col items-center justify-end gap-1">
              <div className="text-[9px] text-gray-500 mb-0.5">山</div>
              <div className="w-3 flex-1 bg-neutral-900 rounded-full overflow-hidden border border-white/5 relative">
                <div
                  className={`absolute bottom-0 w-full transition-all duration-300 ${isDanger ? 'bg-red-500' : 'bg-cyan-500'}`}
                  style={{ height: `${(backlog.length / MAX_BACKLOG) * 100}%` }}
                />
              </div>
              <div className="font-mono text-[10px] text-gray-400">
                {backlog.length}/{MAX_BACKLOG}
              </div>
            </div>

            <div className="mb-8 text-center h-16 flex items-end justify-center">
              {combo > 2 && (
                <div className="animate-in slide-in-from-bottom-4 text-3xl font-black italic text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.6)] flex items-center gap-2">
                  <Zap className="w-8 h-8 fill-cyan-400" /> {combo} COMBO!
                </div>
              )}
            </div>

            <div className="w-full max-w-lg flex flex-col justify-end h-96 relative">
              <div className="flex flex-col-reverse gap-2 mb-4 overflow-hidden mask-image-top">
                {backlog
                  .slice(1)
                  .map((word) => (
                    <div
                      key={word.id}
                      className={`px-4 py-2 rounded-lg text-sm font-bold opacity-70 flex justify-between items-center transition-all ${
                        word.type === 'ojama'
                          ? 'bg-red-950/50 text-red-300 border border-red-900/50'
                          : word.type === 'treasure'
                            ? 'bg-yellow-900/30 text-yellow-300 border border-yellow-700/50'
                            : 'bg-neutral-800 text-gray-400'
                      }`}
                    >
                      <span>{word.display}</span>
                      {word.type === 'ojama' && <AlertTriangle className="w-4 h-4" />}
                      {word.type === 'treasure' && <Sparkles className="w-4 h-4" />}
                    </div>
                  ))}
              </div>
              {renderCurrentWord()}
              {/* 保持アイテム（次の単語を隠さないよう単語の下に表示） */}
              {gameState === 'playing' && heldItem && (
                <div className="flex justify-center">
                  <div className="flex items-center gap-2 bg-neutral-900/90 border border-yellow-600/50 rounded-full px-3 py-1 shadow-lg shadow-yellow-900/30">
                    <ItemIcon type={heldItem} />
                    <span className="text-xs font-bold text-yellow-200">{ITEM_META[heldItem].name}</span>
                    <span className="text-[10px] text-gray-400 hidden sm:inline">{ITEM_META[heldItem].desc}</span>
                    <span className="text-[10px] text-cyan-300 font-bold">[Enter]</span>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4">
              <AttackGauge combo={combo} pinch={isDanger} badges={Math.min(playerKOs, 4)} />
            </div>
          </div>

          {gameState === 'start' && (
            <div className="absolute inset-0 bg-neutral-950/80 backdrop-blur-sm flex flex-col items-center justify-center z-20 rounded-2xl">
              <Swords className="w-20 h-20 text-cyan-500 mb-6" />
              <h2 className="text-4xl font-black tracking-widest mb-2 text-white">TYPE ROYALE</h2>
              <p className="text-gray-400 mb-6 font-mono">Press [SPACE] to Start</p>

              {/* カスタムモードの設定 */}
              {custom && (
                <div className="mb-6 w-full max-w-sm bg-neutral-900/60 border border-amber-700/40 rounded-xl p-4">
                  <div className="text-xs text-amber-300 font-bold mb-3 flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5" /> カスタム設定
                  </div>
                  <label className="block text-[11px] text-gray-400 mb-3">
                    初期供給間隔: <span className="text-cyan-300 font-mono">{(cfgInitial / 1000).toFixed(1)}秒</span>
                    <input
                      type="range"
                      min={500}
                      max={6000}
                      step={100}
                      value={cfgInitial}
                      onChange={(e) => setCfgInitial(Number(e.target.value))}
                      className="w-full accent-cyan-500"
                    />
                  </label>
                  <label className="block text-[11px] text-gray-400 mb-3">
                    最短間隔: <span className="text-cyan-300 font-mono">{(cfgMin / 1000).toFixed(1)}秒</span>
                    <input
                      type="range"
                      min={300}
                      max={3000}
                      step={100}
                      value={cfgMin}
                      onChange={(e) => setCfgMin(Number(e.target.value))}
                      className="w-full accent-cyan-500"
                    />
                  </label>
                  <label className="block text-[11px] text-gray-400">
                    加速の強さ: <span className="text-cyan-300 font-mono">×{cfgAccel.toFixed(2)}</span>
                    <span className="text-gray-600"> （小さいほど速く加速 / 1.00で加速なし）</span>
                    <input
                      type="range"
                      min={0.9}
                      max={1.0}
                      step={0.01}
                      value={cfgAccel}
                      onChange={(e) => setCfgAccel(Number(e.target.value))}
                      className="w-full accent-cyan-500"
                    />
                  </label>
                </div>
              )}

              {/* 出題テーマ選択 */}
              <div className="mb-6 w-full max-w-sm">
                <div className="text-xs text-gray-500 mb-1.5 text-center">出題テーマ</div>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTheme(t.id)}
                      className={`px-2.5 py-1 rounded-full text-xs font-bold transition-colors ${
                        theme === t.id ? 'bg-cyan-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-4 text-sm text-gray-500 bg-neutral-900/50 p-4 rounded-xl">
                <div>🟦 通常単語</div>
                <div>🟥 おじゃま単語</div>
                <div>🟨 お宝単語</div>
              </div>
              <p className="text-xs text-gray-600 mt-4 max-w-sm text-center">
                ノーミスで打ち切ると連鎖UP。5連鎖ごとに敵へおじゃまを送って撃墜！ お宝(🟨)を打つとアイテム獲得 → [Enter] で使用。
              </p>
              <div className="mt-4 text-xs bg-neutral-900/50 p-3 rounded-xl max-w-sm w-full">
                <div className="text-gray-400 font-bold mb-1.5 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-yellow-400" /> アイテム効果（お宝🟨で入手 → [Enter]で使用）
                </div>
                <div className="flex flex-col gap-1 text-left text-gray-400">
                  {(['shield', 'clear', 'brake', 'longbomb', 'rapid'] as const).map((t) => (
                    <div key={t}>
                      <span className="mr-1">{ITEM_META[t].icon}</span>
                      <span className="text-gray-300 font-bold">{ITEM_META[t].name}</span>
                      <span className="text-gray-500"> … {ITEM_META[t].desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ゲージの説明 */}
              <div className="mt-3 text-xs bg-neutral-900/50 p-3 rounded-xl max-w-sm w-full">
                <div className="text-gray-400 font-bold mb-1.5">ゲージの見方</div>
                <div className="flex flex-col gap-1 text-left text-gray-500">
                  <div>
                    <span className="text-cyan-300 font-bold">左の「山」ゲージ</span> … 自分の処理待ち（バックログ）。満タンでトップアウト＝敗北。
                  </div>
                  <div>
                    <span className="text-orange-300 font-bold">攻撃チャージ</span> … 5連鎖ごとに発射。表示の「+N」がその時送る攻撃量。
                  </div>
                  <div>
                    <span className="text-cyan-400 font-bold">連鎖(COMBO)</span> … ノーミスで打ち切った連続数。長いほど攻撃が増える。
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
                <Stat label="KEYS" value={keysTyped} />
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
                <Stat label="KEYS" value={keysTyped} />
                <Stat label="SEED" value={seed} small />
              </div>
              <p className="text-gray-400 font-mono animate-pulse">Press [SPACE] to Retry</p>
            </div>
          )}
        </div>

        <div className="w-1/4 grid grid-cols-2 gap-2 content-start">
          {dummies.slice(10, 20).map((d) => (
            <div key={d.id} ref={(el) => { dummyRefs.current[d.id] = el; }}>
              <MiniBoard height={d.height} max={MAX_BACKLOG} isKO={d.isKO} hit={hitDummy === d.id} />
            </div>
          ))}
        </div>
      </main>

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
  return <Zap className="w-5 h-5 text-yellow-300" />;
};
