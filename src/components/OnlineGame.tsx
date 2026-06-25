import { useState, useEffect, useCallback, useRef } from 'react';
import { Swords, Zap, Trophy, AlertTriangle, Crown } from 'lucide-react';
import { mulberry32, type RNG } from '../lib/rng';
import { generateWord } from '../lib/words';
import { processKey, type PlayerState } from '../lib/engine';
import { serverNow, writePlayerSummary, finishGame, type RoomPlayer, type RoomStatus } from '../lib/room';
import MiniBoard from './MiniBoard';

const MAX_BACKLOG = 12;
const INITIAL_SPAWN_INTERVAL = 4000;
const MIN_SPAWN_INTERVAL = 1000;
const WRITE_INTERVAL = 400; // サマリ書込のスロットリング

interface OnlineGameProps {
  roomId: string;
  uid: string;
  seed: number;
  startAt: number;
  status: RoomStatus;
  hostUid: string;
  players: Record<string, RoomPlayer>;
  onExit: () => void;
}

export default function OnlineGame({ roomId, uid, seed, startAt, status, hostUid, players, onExit }: OnlineGameProps) {
  const [started, setStarted] = useState(false);
  const [countdown, setCountdown] = useState(99);
  const [selfAlive, setSelfAlive] = useState(true);
  const [rank, setRank] = useState(0);

  const [backlog, setBacklog] = useState<PlayerState['backlog']>([]);
  const [tokenIndex, setTokenIndex] = useState(0);
  const [currentTyping, setCurrentTyping] = useState('');
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [keysTyped, setKeysTyped] = useState(0);
  const [spawnInterval, setSpawnInterval] = useState(INITIAL_SPAWN_INTERVAL);
  const [missFlash, setMissFlash] = useState(false);

  const startTimeRef = useRef(0);
  const wordRngRef = useRef<RNG | null>(null);
  const stateRef = useRef<PlayerState>({ backlog, tokenIndex, currentTyping, combo, gameState: 'playing' });
  const selfAliveRef = useRef(true);
  const playersRef = useRef(players);

  useEffect(() => {
    stateRef.current = { backlog, tokenIndex, currentTyping, combo, gameState: 'playing' };
  }, [backlog, tokenIndex, currentTyping, combo]);
  useEffect(() => {
    selfAliveRef.current = selfAlive;
  }, [selfAlive]);
  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  const calculateKPM = useCallback(() => {
    if (!startTimeRef.current || keysTyped === 0) return 0;
    return Math.floor(keysTyped / ((Date.now() - startTimeRef.current) / 60000));
  }, [keysTyped]);

  // シードから RNG と初期バックログを生成（全員同一）。
  useEffect(() => {
    const rng = mulberry32(seed >>> 0);
    wordRngRef.current = rng;
    setBacklog([generateWord(rng), generateWord(rng), generateWord(rng)]);
  }, [seed]);

  // startAt に達したらゲーム開始。それまではカウントダウン表示。
  useEffect(() => {
    if (started) return;
    const tick = () => {
      const remain = startAt - serverNow();
      if (remain <= 0) {
        setStarted(true);
        startTimeRef.current = Date.now();
      } else {
        setCountdown(Math.ceil(remain / 1000));
      }
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [startAt, started]);

  // 自分が脱落。順位を確定して DB に書込。
  const topOut = useCallback(() => {
    if (!selfAliveRef.current) return;
    selfAliveRef.current = false;
    const aliveCount = Object.values(playersRef.current).filter((p) => p.alive).length;
    const myRank = Math.max(1, aliveCount); // 生存者の最下位＝今の順位
    setRank(myRank);
    setSelfAlive(false);
    writePlayerSummary(roomId, uid, { alive: false, rank: myRank, backlog: MAX_BACKLOG });
  }, [roomId, uid]);

  // 入力処理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!started || !selfAliveRef.current) return;
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      const result = processKey(e.key.toLowerCase(), stateRef.current);
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
        setKeysTyped((k) => k + 1);
        // NOTE: 連鎖マイルストーンでの相手への攻撃送信は Phase 2 で実装。
      } else if (result.nextState) {
        setTokenIndex(result.nextState.tokenIndex);
        setCurrentTyping(result.nextState.currentTyping);
        setKeysTyped((k) => k + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [started]);

  // ベース供給＆加速ループ
  useEffect(() => {
    if (!started || !selfAlive) return;
    let timerId: ReturnType<typeof setTimeout>;
    const loop = () => {
      setBacklog((prev) => {
        if (prev.length >= MAX_BACKLOG) {
          topOut();
          return prev;
        }
        const rng = wordRngRef.current;
        return rng ? [...prev, generateWord(rng)] : prev;
      });
      setSpawnInterval((prev) => Math.max(MIN_SPAWN_INTERVAL, prev * 0.98));
      timerId = setTimeout(loop, spawnInterval);
    };
    timerId = setTimeout(loop, spawnInterval);
    return () => clearTimeout(timerId);
  }, [started, selfAlive, spawnInterval, topOut]);

  // サマリのスロットリング書込
  const summaryRef = useRef({ backlog: 0, combo: 0, kpm: 0 });
  summaryRef.current = { backlog: backlog.length, combo, kpm: calculateKPM() };
  useEffect(() => {
    if (!started) return;
    const id = setInterval(() => {
      if (!selfAliveRef.current) return;
      writePlayerSummary(roomId, uid, summaryRef.current);
    }, WRITE_INTERVAL);
    return () => clearInterval(id);
  }, [started, roomId, uid]);

  // ホスト: 生存者が1人以下になったら決着へ。
  useEffect(() => {
    if (uid !== hostUid || status !== 'playing') return;
    const aliveCount = Object.values(players).filter((p) => p.alive).length;
    if (aliveCount <= 1) finishGame(roomId);
  }, [players, status, uid, hostUid, roomId]);

  const others = Object.entries(players).filter(([id]) => id !== uid);
  const aliveCount = Object.values(players).filter((p) => p.alive).length;
  const totalCount = Object.keys(players).length;
  const isDanger = backlog.length >= MAX_BACKLOG - 3;

  // 決着画面
  if (status === 'finished') {
    const ranked = Object.values(players).slice().sort((a, b) => {
      // 生存者を上位、その後 rank 昇順（rank=0 は未確定＝生存者扱い）
      const ra = a.alive ? 0 : a.rank || 999;
      const rb = b.alive ? 0 : b.rank || 999;
      return ra - rb;
    });
    const winner = ranked.find((p) => p.alive) || ranked[0];
    const myRank = selfAlive ? 1 : rank;
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-6">
        <Crown className="w-16 h-16 text-yellow-400 mb-4" />
        <h2 className="text-3xl font-black tracking-widest mb-1">RESULT</h2>
        <p className="text-yellow-300 mb-6 text-lg">勝者: {winner?.name ?? '—'}</p>
        <div className="bg-neutral-900/70 rounded-xl border border-white/10 w-full max-w-md mb-6 divide-y divide-white/5">
          {ranked.map((p, i) => (
            <div key={p.name + i} className="flex items-center justify-between px-4 py-2">
              <span className="flex items-center gap-3">
                <span className="font-mono text-gray-500 w-6">#{i + 1}</span>
                <span className={p.alive ? 'text-yellow-300 font-bold' : 'text-gray-300'}>{p.name}</span>
              </span>
              <span className="text-xs text-gray-500 font-mono">
                {p.kpm} kpm · {p.badges} KO
              </span>
            </div>
          ))}
        </div>
        <p className="text-gray-400 mb-4 font-mono">あなたの順位: {myRank} 位 / 最高連鎖 {maxCombo}</p>
        <button onClick={onExit} className="bg-cyan-600 hover:bg-cyan-500 rounded-lg px-6 py-2 font-bold">
          ロビーに戻る
        </button>
      </div>
    );
  }

  const word = backlog[0];

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans overflow-hidden flex flex-col">
      <div className={`fixed inset-0 pointer-events-none z-50 transition-colors duration-100 ${missFlash ? 'bg-red-500/20' : 'bg-transparent'}`} />

      {/* カウントダウン */}
      {!started && (
        <div className="fixed inset-0 bg-neutral-950/90 flex flex-col items-center justify-center z-50">
          <p className="text-gray-400 mb-2 tracking-widest">GET READY</p>
          <div className="text-8xl font-black text-cyan-400 animate-pulse">{countdown > 0 ? countdown : 'GO!'}</div>
        </div>
      )}

      {/* 自分が脱落して観戦中 */}
      {!selfAlive && status === 'playing' && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 bg-red-950/80 border border-red-500/40 rounded-lg px-6 py-2 text-center">
          <div className="text-red-300 font-bold">TOP OUT — {rank} 位</div>
          <div className="text-xs text-gray-400">観戦中…</div>
        </div>
      )}

      <header className="h-16 border-b border-white/10 flex items-center justify-between px-8 bg-neutral-900/50 z-10">
        <div className="flex items-center gap-3">
          <Swords className="text-cyan-400" />
          <h1 className="text-xl font-bold tracking-widest text-gray-200">
            TYPE ROYALE<span className="text-xs ml-2 text-gray-500">ROOM {roomId}</span>
          </h1>
        </div>
        <div className="flex gap-8">
          <div className="flex flex-col items-center">
            <span className="text-xs text-gray-500">KPM</span>
            <span className="font-mono text-xl font-bold">{calculateKPM()}</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-xs text-gray-500">ALIVE</span>
            <span className="font-mono text-xl font-bold flex items-center gap-1">
              <Trophy className="w-4 h-4 text-yellow-500" /> {aliveCount}/{totalCount}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex w-full max-w-7xl mx-auto p-4 gap-4 h-[calc(100vh-4rem)]">
        <div className="w-1/4 grid grid-cols-2 gap-2 content-start">
          {others.slice(0, Math.ceil(others.length / 2)).map(([id, p]) => (
            <MiniBoard key={id} height={p.backlog} max={MAX_BACKLOG} isKO={!p.alive} name={p.name} combo={p.combo} />
          ))}
        </div>

        <div className="w-2/4 flex flex-col h-full relative">
          {isDanger && selfAlive && started && (
            <div className="absolute inset-0 border-4 border-red-500/50 rounded-2xl pointer-events-none animate-pulse z-0" />
          )}
          <div className="flex-1 flex flex-col items-center justify-end pb-8 relative z-10">
            <div className="mb-8 text-center h-16 flex items-end justify-center">
              {combo > 2 && (
                <div className="text-3xl font-black italic text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.6)] flex items-center gap-2">
                  <Zap className="w-8 h-8 fill-cyan-400" /> {combo} COMBO!
                </div>
              )}
            </div>

            <div className="w-full max-w-lg flex flex-col justify-end h-96 relative">
              <div className="flex flex-col-reverse gap-2 mb-4 overflow-hidden">
                {backlog
                  .slice(1)
                  .reverse()
                  .map((w) => (
                    <div
                      key={w.id}
                      className={`px-4 py-2 rounded-lg text-sm font-bold opacity-70 flex justify-between items-center ${
                        w.type === 'ojama'
                          ? 'bg-red-950/50 text-red-300 border border-red-900/50'
                          : w.type === 'treasure'
                            ? 'bg-yellow-900/30 text-yellow-300 border border-yellow-700/50'
                            : 'bg-neutral-800 text-gray-400'
                      }`}
                    >
                      <span>{w.text}</span>
                      {w.type === 'ojama' && <AlertTriangle className="w-4 h-4" />}
                    </div>
                  ))}
              </div>

              {word && (
                <div className="p-6 rounded-xl border-2 border-blue-500/30 bg-gray-800/80 shadow-2xl mb-4">
                  <div className="flex justify-center items-center text-4xl md:text-5xl font-bold tracking-widest mb-4">
                    {word.tokens.map((t, i) => {
                      let c = 'text-gray-400';
                      if (i < tokenIndex) c = 'text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]';
                      if (i === tokenIndex) c = 'text-cyan-400';
                      return (
                        <span key={i} className={c}>
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
                        const target = t.romaji.find((r) => r.startsWith(currentTyping)) || t.romaji[0];
                        return (
                          <span key={i} className="flex">
                            <span className="text-cyan-300">{currentTyping}</span>
                            <span className="text-gray-400 opacity-70">{target.slice(currentTyping.length)}</span>
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
              )}
            </div>

            <div className="w-full max-w-lg flex gap-1 mt-2">
              {Array.from({ length: MAX_BACKLOG }).map((_, i) => (
                <div
                  key={i}
                  className={`h-2 flex-1 rounded-sm ${
                    i < backlog.length ? (i >= MAX_BACKLOG - 3 ? 'bg-red-500' : 'bg-cyan-500') : 'bg-neutral-800'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="w-1/4 grid grid-cols-2 gap-2 content-start">
          {others.slice(Math.ceil(others.length / 2)).map(([id, p]) => (
            <MiniBoard key={id} height={p.backlog} max={MAX_BACKLOG} isKO={!p.alive} name={p.name} combo={p.combo} />
          ))}
        </div>
      </main>
    </div>
  );
}
