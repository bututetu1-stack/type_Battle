import { useState, useEffect, useCallback, useRef } from 'react';
import { Swords, Zap, Trophy, Shield, AlertTriangle, Sparkles } from 'lucide-react';

// --- 定数・辞書データ ---
const MAX_BACKLOG = 12;
const INITIAL_SPAWN_INTERVAL = 4000;
const MIN_SPAWN_INTERVAL = 1000;

// タイピングのお題プール
const WORD_POOL = [
  'ありがとう', 'こんにちは', 'たいぴんぐ', 'ばとるろわいやる', 'ぱそこん',
  'きーぼーど', 'まうす', 'いんたーねっと', 'ぷろぐらみんぐ', 'えんじにあ',
  'てとます', 'ぷよぷよ', 'すまーとふぉん', 'あぷりけーしょん',
  'しょうがっこう', 'だいがく', 'おにぎり', 'はんばーがー', 'らーめん',
  'たいよう', 'うちゅう', 'あおぞら', 'しんかんせん', 'ひこうき',
  'りんご', 'みかん', 'すいか', 'がんばって', 'れべるあっぷ', 'あいてむ',
];

// ローマ字入力マッピング（柔軟な入力に対応）
const ROMAJI_MAP: Record<string, string[]> = {
  'あ': ['a'], 'い': ['i'], 'う': ['u', 'wu'], 'え': ['e'], 'お': ['o'],
  'か': ['ka', 'ca'], 'き': ['ki'], 'く': ['ku', 'cu', 'qu'], 'け': ['ke'], 'こ': ['ko', 'co'],
  'さ': ['sa'], 'し': ['shi', 'si', 'ci'], 'す': ['su'], 'せ': ['se', 'ce'], 'そ': ['so'],
  'た': ['ta'], 'ち': ['chi', 'ti'], 'つ': ['tsu', 'tu'], 'て': ['te'], 'と': ['to'],
  'な': ['na'], 'に': ['ni'], 'ぬ': ['nu'], 'ね': ['ne'], 'の': ['no'],
  'は': ['ha'], 'ひ': ['hi'], 'ふ': ['fu', 'hu'], 'へ': ['he'], 'ほ': ['ho'],
  'ま': ['ma'], 'み': ['mi'], 'む': ['mu'], 'め': ['me'], 'も': ['mo'],
  'や': ['ya'], 'ゆ': ['yu'], 'よ': ['yo'],
  'ら': ['ra'], 'り': ['ri'], 'る': ['ru'], 'れ': ['re'], 'ろ': ['ro'],
  'わ': ['wa'], 'を': ['wo'], 'ん': ['nn', 'xn'],
  'が': ['ga'], 'ぎ': ['gi'], 'ぐ': ['gu'], 'げ': ['ge'], 'ご': ['go'],
  'ざ': ['za'], 'じ': ['ji', 'zi'], 'ず': ['zu'], 'ぜ': ['ze'], 'ぞ': ['zo'],
  'だ': ['da'], 'ぢ': ['di'], 'づ': ['du'], 'で': ['de'], 'ど': ['do'],
  'ば': ['ba'], 'び': ['bi'], 'ぶ': ['bu'], 'べ': ['be'], 'ぼ': ['bo'],
  'ぱ': ['pa'], 'ぴ': ['pi'], 'ぷ': ['pu'], 'ぺ': ['pe'], 'ぽ': ['po'],
  'きゃ': ['kya'], 'きゅ': ['kyu'], 'きょ': ['kyo'],
  'しゃ': ['sha', 'sya'], 'しゅ': ['shu', 'syu'], 'しょ': ['sho', 'syo'],
  'ちゃ': ['cha', 'tya', 'cya'], 'ちゅ': ['chu', 'tyu', 'cyu'], 'ちょ': ['cho', 'tyo', 'cyo'],
  'にゃ': ['nya'], 'にゅ': ['nyu'], 'にょ': ['nyo'],
  'ひゃ': ['hya'], 'ひゅ': ['hyu'], 'ひょ': ['hyo'],
  'みゃ': ['mya'], 'みゅ': ['myu'], 'みょ': ['myo'],
  'りゃ': ['rya'], 'りゅ': ['ryu'], 'りょ': ['ryo'],
  'ぎゃ': ['gya'], 'ぎゅ': ['gyu'], 'ぎょ': ['gyo'],
  'じゃ': ['ja', 'jya', 'zya'], 'じゅ': ['ju', 'jyu', 'zyu'], 'じょ': ['jo', 'jyo', 'zyo'],
  'びゃ': ['bya'], 'びゅ': ['byu'], 'びょ': ['byo'],
  'ぴゃ': ['pya'], 'ぴゅ': ['pyu'], 'ぴょ': ['pyo'],
  'ふぁ': ['fa'], 'ふぃ': ['fi'], 'ふぇ': ['fe'], 'ふぉ': ['fo'],
  'てぃ': ['thi'], 'でぃ': ['dhi'],
  'ー': ['-'],
  'っ': ['xtsu', 'xtu', 'ltsu', 'ltu'],
  'ぁ': ['xa', 'la'], 'ぃ': ['xi', 'li'], 'ぅ': ['xu', 'lu'], 'ぇ': ['xe', 'le'], 'ぉ': ['xo', 'lo'],
  'ゃ': ['xya', 'lya'], 'ゅ': ['xyu', 'lyu'], 'ょ': ['xyo', 'lyo'],
};

// --- 型定義 ---
type GameStatus = 'start' | 'playing' | 'gameover';
type WordType = 'normal' | 'ojama' | 'treasure';

interface Token {
  kana: string;
  romaji: string[];
}

interface Word {
  id: string;
  text: string;
  type: WordType;
  tokens: Token[];
}

interface Dummy {
  id: number;
  height: number;
  isKO: boolean;
}

interface PlayerState {
  backlog: Word[];
  tokenIndex: number;
  currentTyping: string;
  combo: number;
  gameState: GameStatus;
}

interface ProcessResult {
  miss?: boolean;
  wordCleared?: boolean;
  clearedType?: WordType;
  nextState?: PlayerState;
}

// 単語をトークン（判定単位）に分割する関数
const tokenizeWord = (word: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < word.length) {
    const char = word[i];
    const nextChar = word[i + 1] || '';
    if (ROMAJI_MAP[char + nextChar]) {
      tokens.push({ kana: char + nextChar, romaji: ROMAJI_MAP[char + nextChar] });
      i += 2;
    } else if (ROMAJI_MAP[char]) {
      tokens.push({ kana: char, romaji: ROMAJI_MAP[char] });
      i += 1;
    } else {
      tokens.push({ kana: char, romaji: [char] });
      i += 1;
    }
  }
  return tokens;
};

// 新しい単語オブジェクトを生成する関数
const generateWord = (): Word => {
  const text = WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)];
  const rand = Math.random();
  let type: WordType = 'normal';
  if (rand < 0.1) type = 'treasure'; // 10%でお宝
  else if (rand < 0.3) type = 'ojama'; // 20%でおじゃま（ダミー効果）

  return {
    id: Math.random().toString(36).substring(2, 11),
    text,
    type,
    tokens: tokenizeWord(text),
  };
};

export default function App() {
  const [gameState, setGameState] = useState<GameStatus>('start'); // 'start', 'playing', 'gameover'

  // プレイヤーの状態
  const [backlog, setBacklog] = useState<Word[]>([]);
  const [tokenIndex, setTokenIndex] = useState(0);
  const [currentTyping, setCurrentTyping] = useState('');
  const [combo, setCombo] = useState(0);
  const [keysTyped, setKeysTyped] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [spawnInterval, setSpawnInterval] = useState(INITIAL_SPAWN_INTERVAL);

  // 演出用ステート
  const [missFlash, setMissFlash] = useState(false);
  const [itemFlash, setItemFlash] = useState(false);

  // ダミープレイヤーの状態 (20人)
  const [dummies, setDummies] = useState<Dummy[]>(
    Array.from({ length: 20 }).map((_, i) => ({ id: i, height: 0, isKO: false })),
  );

  const stateRef = useRef<PlayerState>({ backlog, tokenIndex, currentTyping, combo, gameState });
  useEffect(() => {
    stateRef.current = { backlog, tokenIndex, currentTyping, combo, gameState };
  }, [backlog, tokenIndex, currentTyping, combo, gameState]);

  // 打鍵判定コアロジック (再帰的に次トークン判定も行う)
  const processKey = useCallback((key: string, state: PlayerState): ProcessResult => {
    const { backlog, tokenIndex, currentTyping, combo } = state;
    if (backlog.length === 0) return { miss: false };

    const word = backlog[0];
    const currentToken = word.tokens[tokenIndex];

    // 特殊処理: 「っ」のショートカット (次の文字の子音で「っ」を確定)
    if (currentTyping === '' && currentToken.kana === 'っ') {
      const nextT = word.tokens[tokenIndex + 1];
      if (nextT && nextT.romaji.some((r) => r.startsWith(key) && !['a', 'i', 'u', 'e', 'o', 'y'].includes(key))) {
        return processKey(key, { ...state, tokenIndex: tokenIndex + 1 });
      }
    }
    // 特殊処理: 「ん」のショートカット (nの次が母音/y/n以外の子音なら確定)
    if (currentTyping === 'n' && currentToken.kana === 'ん') {
      const nextT = word.tokens[tokenIndex + 1];
      if (nextT && nextT.kana !== 'ん' && nextT.romaji.some((r) => r.startsWith(key) && !['a', 'i', 'u', 'e', 'o', 'y', 'n'].includes(key))) {
        return processKey(key, { ...state, tokenIndex: tokenIndex + 1, currentTyping: '' });
      }
    }

    // 通常判定
    const nextTyping = currentTyping + key;
    let isValid = false;
    let isComplete = false;

    for (const r of currentToken.romaji) {
      if (r.startsWith(nextTyping)) {
        isValid = true;
        if (r === nextTyping) isComplete = true;
        break;
      }
    }

    if (isValid) {
      if (isComplete) {
        // トークン完了
        const nextTokenIndex = tokenIndex + 1;
        if (nextTokenIndex >= word.tokens.length) {
          // 単語クリア！
          return {
            wordCleared: true,
            clearedType: word.type,
            nextState: { ...state, backlog: backlog.slice(1), tokenIndex: 0, currentTyping: '', combo: combo + 1 },
          };
        } else {
          // 次のトークンへ
          return { miss: false, nextState: { ...state, tokenIndex: nextTokenIndex, currentTyping: '' } };
        }
      } else {
        // 入力中（前方一致）
        return { miss: false, nextState: { ...state, currentTyping: nextTyping } };
      }
    } else {
      // ミス！
      return { miss: true, nextState: { ...state, combo: 0 } };
    }
  }, []);

  const startGame = useCallback(() => {
    setBacklog([generateWord(), generateWord(), generateWord()]);
    setTokenIndex(0);
    setCurrentTyping('');
    setCombo(0);
    setKeysTyped(0);
    setStartTime(Date.now());
    setSpawnInterval(INITIAL_SPAWN_INTERVAL);
    setGameState('playing');
    setDummies((prev) => prev.map((d) => ({ ...d, height: Math.floor(Math.random() * 5), isKO: false })));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { gameState } = stateRef.current;

      if (gameState === 'start' && e.key === ' ') {
        startGame();
        return;
      }
      if (gameState === 'gameover' && e.key === ' ') {
        startGame();
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
        setBacklog(result.nextState.backlog);
        setTokenIndex(0);
        setCurrentTyping('');
        setCombo(result.nextState.combo);
        setKeysTyped((prev) => prev + 1);

        if (result.clearedType === 'treasure') {
          setItemFlash(true);
          setTimeout(() => setItemFlash(false), 1000);
        }
      } else if (result.nextState) {
        setTokenIndex(result.nextState.tokenIndex);
        setCurrentTyping(result.nextState.currentTyping);
        setKeysTyped((prev) => prev + 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [processKey, startGame]);

  const gameOver = useCallback(() => {
    setGameState('gameover');
  }, []);

  // 敵のダミー更新ループ
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

  // 自分へのお題供給＆加速ループ
  useEffect(() => {
    if (gameState !== 'playing') return;

    let timerId: ReturnType<typeof setTimeout>;
    const loop = () => {
      setBacklog((prev) => {
        if (prev.length >= MAX_BACKLOG) {
          gameOver();
          return prev;
        }
        return [...prev, generateWord()];
      });

      // 加速（最小間隔まで徐々に短くする）
      setSpawnInterval((prev) => Math.max(MIN_SPAWN_INTERVAL, prev * 0.98));

      timerId = setTimeout(loop, spawnInterval);
    };

    timerId = setTimeout(loop, spawnInterval);
    return () => clearTimeout(timerId);
  }, [gameState, spawnInterval, gameOver]);

  const calculateKPM = () => {
    if (!startTime || keysTyped === 0) return 0;
    const minutes = (Date.now() - startTime) / 60000;
    return Math.floor(keysTyped / minutes);
  };

  // 現在のお題のレンダリング
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
        {/* ひらがな表示 */}
        <div className="flex justify-center items-center text-4xl md:text-5xl font-bold tracking-widest mb-4">
          {word.tokens.map((t, i) => {
            let colorClass = 'text-gray-400'; // 未入力
            if (i < tokenIndex) colorClass = 'text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]'; // 完了
            if (i === tokenIndex) colorClass = isOjama ? 'text-red-400' : isTreasure ? 'text-yellow-400' : 'text-cyan-400'; // 入力中

            return (
              <span key={i} className={`${colorClass} transition-colors duration-100`}>
                {t.kana}
              </span>
            );
          })}
        </div>

        {/* ローマ字ガイド表示 */}
        <div className="flex justify-center items-center text-xl md:text-2xl font-mono tracking-[0.2em]">
          {word.tokens.map((t, i) => {
            if (i < tokenIndex) {
              return (
                <span key={i} className="text-gray-600">
                  {''.padEnd(t.romaji[0].length, '-')}
                </span>
              );
            }
            if (i === tokenIndex) {
              // 柔軟な入力に対応した表示
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

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-sans overflow-hidden flex flex-col selection:bg-cyan-900">
      {/* 画面フラッシュ演出 */}
      <div
        className={`fixed inset-0 pointer-events-none z-50 transition-colors duration-100 ${
          missFlash ? 'bg-red-500/20' : 'bg-transparent'
        }`}
      />

      {/* アイテム獲得演出 */}
      {itemFlash && (
        <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none animate-in fade-in zoom-in duration-300">
          <div className="text-5xl font-black text-yellow-300 drop-shadow-[0_0_20px_rgba(250,204,21,0.8)] flex items-center gap-4">
            <Sparkles className="w-12 h-12" /> ITEM GET! <Sparkles className="w-12 h-12" />
          </div>
        </div>
      )}

      {/* トップヘッダー */}
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-8 bg-neutral-900/50 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <Swords className="text-cyan-400" />
          <h1 className="text-xl font-bold tracking-widest text-gray-200">
            TYPE ROYALE<span className="text-xs ml-2 text-gray-500">PROTOTYPE</span>
          </h1>
        </div>
        <div className="flex gap-8">
          <div className="flex flex-col items-center">
            <span className="text-xs text-gray-500">KPM</span>
            <span className="font-mono text-xl font-bold">{calculateKPM()}</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-xs text-gray-500">K.O.</span>
            <span className="font-mono text-xl font-bold flex items-center gap-1">
              <Trophy className="w-4 h-4 text-yellow-500" /> {dummies.filter((d) => d.isKO).length}
            </span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-xs text-gray-500">BADGE</span>
            <span className="font-mono text-xl font-bold flex items-center gap-1">
              <Shield className="w-4 h-4 text-blue-400" /> 0
            </span>
          </div>
        </div>
      </header>

      {/* メイングリッド (バトロワレイアウト) */}
      <main className="flex-1 flex w-full max-w-7xl mx-auto p-4 gap-4 h-[calc(100vh-4rem)]">
        {/* 左側ダミープレイヤー群 */}
        <div className="w-1/4 grid grid-cols-2 gap-2 content-start">
          {dummies.slice(0, 10).map((d) => (
            <DummyBoard key={d.id} data={d} />
          ))}
        </div>

        {/* 中央プレイエリア */}
        <div className="w-2/4 flex flex-col h-full relative">
          {/* 危険域の脈動エフェクト */}
          {isDanger && gameState === 'playing' && (
            <div className="absolute inset-0 border-4 border-red-500/50 rounded-2xl pointer-events-none animate-pulse z-0" />
          )}

          <div className="flex-1 flex flex-col items-center justify-end pb-8 relative z-10">
            {/* 予告ゲージ (左脇) */}
            <div className="absolute left-0 bottom-8 top-1/4 w-3 bg-neutral-900 rounded-full overflow-hidden border border-white/5">
              <div
                className="absolute bottom-0 w-full bg-red-500 transition-all duration-500"
                style={{ height: `${(backlog.length / MAX_BACKLOG) * 100}%` }}
              />
            </div>

            {/* コンボ表示 */}
            <div className="mb-8 text-center h-16 flex items-end justify-center">
              {combo > 2 && (
                <div className="animate-in slide-in-from-bottom-4 text-3xl font-black italic text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.6)] flex items-center gap-2">
                  <Zap className="w-8 h-8 fill-cyan-400" /> {combo} COMBO!
                </div>
              )}
            </div>

            {/* お題＆バックログコンテナ */}
            <div className="w-full max-w-lg flex flex-col justify-end h-96 relative">
              {/* バックログ表示（次のお題） */}
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

              {/* 現在打つべきお題（一番下/目立つ） */}
              {renderCurrentWord()}
            </div>

            {/* 警告メーターの下敷き */}
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

          {/* オーバーレイUI (Start / GameOver) */}
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
            </div>
          )}

          {gameState === 'gameover' && (
            <div className="absolute inset-0 bg-red-950/90 backdrop-blur-md flex flex-col items-center justify-center z-20 rounded-2xl">
              <h2 className="text-5xl font-black text-white mb-2 tracking-widest drop-shadow-[0_0_15px_rgba(220,38,38,0.8)]">
                TOP OUT
              </h2>
              <p className="text-red-300 mb-8">おじゃまブロックがあふれました</p>
              <div className="bg-black/40 p-6 rounded-xl flex gap-8 mb-8 border border-red-500/30">
                <div className="text-center">
                  <div className="text-xs text-red-400/80">KPM</div>
                  <div className="text-3xl font-mono">{calculateKPM()}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-red-400/80">KEYS</div>
                  <div className="text-3xl font-mono">{keysTyped}</div>
                </div>
              </div>
              <p className="text-gray-400 font-mono animate-pulse">Press [SPACE] to Retry</p>
            </div>
          )}
        </div>

        {/* 右側ダミープレイヤー群 */}
        <div className="w-1/4 grid grid-cols-2 gap-2 content-start">
          {dummies.slice(10, 20).map((d) => (
            <DummyBoard key={d.id} data={d} />
          ))}
        </div>
      </main>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .mask-image-top {
          mask-image: linear-gradient(to bottom, transparent 0%, black 20%);
          -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 20%);
        }
      `,
        }}
      />
    </div>
  );
}

// 周囲のダミープレイヤー用ミニボードコンポーネント
const DummyBoard = ({ data }: { data: Dummy }) => {
  if (data.isKO) {
    return (
      <div className="aspect-[3/4] bg-neutral-900/40 rounded-md border border-neutral-800 flex items-center justify-center relative overflow-hidden">
        <div className="text-neutral-700 font-black text-2xl rotate-[-15deg]">K.O.</div>
        <div className="absolute inset-0 bg-red-950/20 mix-blend-overlay"></div>
      </div>
    );
  }

  const dangerLevel = data.height / MAX_BACKLOG;

  return (
    <div
      className={`aspect-[3/4] rounded-md border p-1 flex flex-col justify-end transition-colors duration-500 ${
        dangerLevel > 0.7 ? 'bg-red-950/20 border-red-900/50' : 'bg-neutral-900/50 border-neutral-800'
      }`}
    >
      {/* ゲージの描画 */}
      <div className="w-full flex gap-[1px] h-full items-end opacity-50">
        {Array.from({ length: MAX_BACKLOG }).map((_, i) => (
          <div
            key={i}
            className={`flex-1 transition-all duration-300 ${
              MAX_BACKLOG - i <= data.height ? (dangerLevel > 0.7 ? 'bg-red-500' : 'bg-gray-400') : 'bg-transparent'
            }`}
            style={{ height: `${((MAX_BACKLOG - i) / MAX_BACKLOG) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
};
