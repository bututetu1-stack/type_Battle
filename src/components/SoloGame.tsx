import { useState, useEffect, useCallback, useRef } from 'react';
import { Swords, Zap, Trophy, Shield, AlertTriangle, Sparkles, Wind, Pause, ArrowLeft } from 'lucide-react';
import { mulberry32, randomSeed, type RNG } from '../lib/rng';
import { generateWord } from '../lib/words';
import { processKey, type PlayerState } from '../lib/engine';
import type { Dummy, GameStatus, ItemType } from '../lib/types';
import MiniBoard from './MiniBoard';

// --- 定数 ---
const MAX_BACKLOG = 12;
const INITIAL_SPAWN_INTERVAL = 4000;
const MIN_SPAWN_INTERVAL = 1000;
const DUMMY_COUNT = 20;
const BRAKE_DURATION = 5000;

const ITEM_META: Record<ItemType, { name: string }> = {
  shield: { name: 'シールド' },
  clear: { name: 'おじゃま一掃' },
  brake: { name: 'ブレーキ' },
};

export default function SoloGame({ onExit }: { onExit: () => void }) {
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
    if (willKO) setPlayerKOs((k) => k + 1);
    setAttackFlash(amount);
    setTimeout(() => setAttackFlash(0), 600);
  }, []);

  const grantItem = useCallback(() => {
    const rng = itemRngRef.current;
    const items: ItemType[] = ['shield', 'clear', 'brake'];
    const pick = rng ? items[Math.floor(rng() * items.length)] : items[0];
    setHeldItem(pick);
    setItemFlash(true);
    setTimeout(() => setItemFlash(false), 1000);
  }, []);

  const useItem = useCallback(() => {
    const item = heldItemRef.current;
    if (!item) return;
    if (item === 'shield') shieldRef.current = true;
    else if (item === 'brake') brakeUntilRef.current = Date.now() + BRAKE_DURATION;
    else if (item === 'clear')
      setBacklog((prev) => (prev.length <= 1 ? prev : [prev[0], ...prev.slice(1).filter((w) => w.type !== 'ojama')]));
    setHeldItem(null);
  }, []);

  const startGame = useCallback(() => {
    const newSeed = randomSeed();
    const wordRng = mulberry32(newSeed);
    const itemRng = mulberry32((newSeed ^ 0x9e3779b9) >>> 0);
    wordRngRef.current = wordRng;
    itemRngRef.current = itemRng;
    shieldRef.current = false;
    brakeUntilRef.current = 0;
    setSeed(newSeed);
    setBacklog([generateWord(wordRng), generateWord(wordRng), generateWord(wordRng)]);
    setTokenIndex(0);
    setCurrentTyping('');
    setCombo(0);
    setMaxCombo(0);
    setScore(0);
    setKeysTyped(0);
    setPlayerKOs(0);
    setHeldItem(null);
    setStartTime(Date.now());
    setSpawnInterval(INITIAL_SPAWN_INTERVAL);
    setGameState('playing');
    setDummies((prev) => prev.map((d) => ({ ...d, height: Math.floor(Math.random() * 5), isKO: false })));
  }, []);

  const gameOver = useCallback(() => setGameState('gameover'), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { gameState } = stateRef.current;
      if ((gameState === 'start' || gameState === 'gameover') && e.key === ' ') {
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
        if (newCombo >= 5 && newCombo % 5 === 0) fireAttack(newCombo / 5);
        if (result.clearedType === 'treasure') grantItem();
      } else if (result.nextState) {
        setTokenIndex(result.nextState.tokenIndex);
        setCurrentTyping(result.nextState.currentTyping);
        setKeysTyped((prev) => prev + 1);
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
          let newHeight = d.height + (Math.random() > 0.5 ? 1 : -1);
          if (newHeight < 0) newHeight = 0;
          if (newHeight > MAX_BACKLOG) return { ...d, height: 0, isKO: true };
          return { ...d, height: newHeight };
        }),
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [gameState]);

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
          return rng ? [...prev, generateWord(rng)] : prev;
        });
      }
      setSpawnInterval((prev) => Math.max(MIN_SPAWN_INTERVAL, prev * 0.98));
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
        <div className="flex justify-center items-center text-4xl md:text-5xl font-bold tracking-widest mb-4">
          {word.tokens.map((t, i) => {
            let colorClass = 'text-gray-400';
            if (i < tokenIndex) colorClass = 'text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]';
            if (i === tokenIndex) colorClass = isOjama ? 'text-red-400' : isTreasure ? 'text-yellow-400' : 'text-cyan-400';
            return (
              <span key={i} className={`${colorClass} transition-colors duration-100`}>
                {t.kana}
              </span>
            );
          })}
        </div>
        <div className="flex justify-center items-center text-xl md:text-2xl font-mono tracking-[0.2em]">
          {word.tokens.map((t, i) => {
            if (i < tokenIndex)
              return (
                <span key={i} className="text-gray-600">
                  {''.padEnd(t.romaji[0].length, '-')}
                </span>
              );
            if (i === tokenIndex) {
              const typed = currentTyping;
              const target = t.romaji.find((r) => r.startsWith(typed)) || t.romaji[0];
              const remain = target.slice(typed.length);
              return (
                <span key={i} className="flex">
                  <span className="text-cyan-300">{typed}</span>
                  <span className="text-gray-400 opacity-70">{remain}</span>
                </span>
              );
            }
            return (
              <span key={i} className="text-gray-500 opacity-50">
                {t.romaji[0]}
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  const isDanger = backlog.length >= MAX_BACKLOG - 3;
  const eliminatedCount = dummies.filter((d) => d.isKO).length;
  const survivors = DUMMY_COUNT + 1 - eliminatedCount;

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans overflow-hidden flex flex-col selection:bg-cyan-900">
      <div className={`fixed inset-0 pointer-events-none z-50 transition-colors duration-100 ${missFlash ? 'bg-red-500/20' : 'bg-transparent'}`} />

      {attackFlash > 0 && (
        <div className="fixed top-1/3 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="text-4xl font-black italic text-orange-400 drop-shadow-[0_0_15px_rgba(251,146,60,0.8)] flex items-center gap-2">
            <Swords className="w-9 h-9" /> ATTACK ×{attackFlash}!
          </div>
        </div>
      )}

      {itemFlash && (
        <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none animate-in fade-in zoom-in duration-300">
          <div className="text-5xl font-black text-yellow-300 drop-shadow-[0_0_20px_rgba(250,204,21,0.8)] flex items-center gap-4">
            <Sparkles className="w-12 h-12" /> ITEM GET! <Sparkles className="w-12 h-12" />
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
        </div>
      </header>

      <main className="flex-1 flex w-full max-w-7xl mx-auto p-4 gap-4 h-[calc(100vh-4rem)]">
        <div className="w-1/4 grid grid-cols-2 gap-2 content-start">
          {dummies.slice(0, 10).map((d) => (
            <MiniBoard key={d.id} height={d.height} max={MAX_BACKLOG} isKO={d.isKO} />
          ))}
        </div>

        <div className="w-2/4 flex flex-col h-full relative">
          {isDanger && gameState === 'playing' && (
            <div className="absolute inset-0 border-4 border-red-500/50 rounded-2xl pointer-events-none animate-pulse z-0" />
          )}

          <div className="flex-1 flex flex-col items-center justify-end pb-8 relative z-10">
            {gameState === 'playing' && (
              <div className="absolute top-2 right-0 text-right">
                <div className="text-xs text-gray-500">ALIVE</div>
                <div className="font-mono text-2xl font-bold text-gray-300">
                  {survivors}
                  <span className="text-sm text-gray-600"> / {DUMMY_COUNT + 1}</span>
                </div>
              </div>
            )}

            {gameState === 'playing' && heldItem && (
              <div className="absolute top-2 left-0">
                <div className="text-xs text-gray-500 mb-1">ITEM</div>
                <div className="flex items-center gap-2 bg-neutral-900/80 border border-yellow-600/40 rounded-lg px-3 py-2">
                  <ItemIcon type={heldItem} />
                  <div className="leading-tight">
                    <div className="text-sm font-bold text-yellow-200">{ITEM_META[heldItem].name}</div>
                    <div className="text-[10px] text-gray-500">[Enter] で使用</div>
                  </div>
                </div>
              </div>
            )}

            <div className="absolute left-0 bottom-8 top-1/4 w-3 bg-neutral-900 rounded-full overflow-hidden border border-white/5">
              <div className="absolute bottom-0 w-full bg-red-500 transition-all duration-500" style={{ height: `${(backlog.length / MAX_BACKLOG) * 100}%` }} />
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
                  .reverse()
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
                      <span>{word.text}</span>
                      {word.type === 'ojama' && <AlertTriangle className="w-4 h-4" />}
                      {word.type === 'treasure' && <Sparkles className="w-4 h-4" />}
                    </div>
                  ))}
              </div>
              {renderCurrentWord()}
            </div>

            <div className="w-full max-w-lg flex gap-1 mt-2">
              {Array.from({ length: MAX_BACKLOG }).map((_, i) => (
                <div
                  key={i}
                  className={`h-2 flex-1 rounded-sm transition-colors ${
                    i < backlog.length ? (i >= MAX_BACKLOG - 3 ? 'bg-red-500' : 'bg-cyan-500') : 'bg-neutral-800'
                  }`}
                />
              ))}
            </div>
          </div>

          {gameState === 'start' && (
            <div className="absolute inset-0 bg-neutral-950/80 backdrop-blur-sm flex flex-col items-center justify-center z-20 rounded-2xl">
              <Swords className="w-20 h-20 text-cyan-500 mb-6" />
              <h2 className="text-4xl font-black tracking-widest mb-2 text-white">TYPE ROYALE</h2>
              <p className="text-gray-400 mb-8 font-mono">Press [SPACE] to Start</p>
              <div className="flex gap-4 text-sm text-gray-500 bg-neutral-900/50 p-4 rounded-xl">
                <div>🟦 通常単語</div>
                <div>🟥 おじゃま単語</div>
                <div>🟨 お宝単語</div>
              </div>
              <p className="text-xs text-gray-600 mt-4 max-w-sm text-center">
                ノーミスで打ち切ると連鎖UP。5連鎖ごとに敵へおじゃまを送って撃墜！ お宝(🟨)を打つとアイテム獲得 → [Enter] で使用。
              </p>
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
        </div>

        <div className="w-1/4 grid grid-cols-2 gap-2 content-start">
          {dummies.slice(10, 20).map((d) => (
            <MiniBoard key={d.id} height={d.height} max={MAX_BACKLOG} isKO={d.isKO} />
          ))}
        </div>
      </main>

      <style dangerouslySetInnerHTML={{ __html: `.mask-image-top{mask-image:linear-gradient(to bottom,transparent 0%,black 20%);-webkit-mask-image:linear-gradient(to bottom,transparent 0%,black 20%);}` }} />
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
  if (type === 'shield') return <Shield className="w-6 h-6 text-blue-300" />;
  if (type === 'clear') return <Wind className="w-6 h-6 text-cyan-300" />;
  return <Pause className="w-6 h-6 text-green-300" />;
};
