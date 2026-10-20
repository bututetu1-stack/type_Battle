import { lazy, Suspense, useEffect, useState } from 'react';
import { Loader2, Swords, Users, Settings, BookPlus, Trophy, ChevronRight } from 'lucide-react';
import { firebaseReady, OFFLINE_MESSAGE } from './lib/firebaseEnv';
import PlayerSettings from './components/PlayerSettings';
import { applyColorTheme, loadThemeId } from './lib/theme';
import { loadCustomWords, saveCustomWords, loadCustomGroups, saveCustomGroups, type CustomWord } from './lib/customwords';
import { loadScores } from './lib/scores';

// 初回表示を速くするため、重いものはホームを出した後で読み込む。
//   単語辞書（words.ts 約270KB）… ソロ／オンラインの画面と一緒に
//   Firebase SDK（約340KB）… オンライン・記録画面と匿名サインインの時に
// ホームが出たら空き時間に先読みするので、ボタンを押した時はほぼ待たない。
const loadSolo = () => import('./components/SoloGame');
const loadLobby = () => import('./components/Lobby');
const loadRoom = () => import('./components/OnlineRoom');
const loadWordEditor = () => import('./components/WordEditor');
const loadRecords = () => import('./components/RecordsBoard');
const loadWords = () => import('./lib/words');
const SoloGame = lazy(loadSolo);
const Lobby = lazy(loadLobby);
const OnlineRoom = lazy(loadRoom);
const WordEditor = lazy(loadWordEditor);
const RecordsBoard = lazy(loadRecords);

// ブラウザが暇になったら実行（未対応のブラウザは少し待ってから）。
const whenIdle = (fn: () => void) => {
  if ('requestIdleCallback' in window) window.requestIdleCallback(fn, { timeout: 1500 });
  else setTimeout(fn, 200);
};

type View = 'home' | 'solo' | 'lobby' | 'room';

export default function App() {
  const [view, setView] = useState<View>('home');
  const [uid, setUid] = useState<string | null>(null);
  const [authError, setAuthError] = useState('');
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showWords, setShowWords] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  const [customWords, setCustomWords] = useState<CustomWord[]>(() => loadCustomWords());
  const [customGroups, setCustomGroups] = useState<string[]>(() => loadCustomGroups());

  // 起動時に保存済みカラーテーマを body 背景へ適用（全画面共通）。
  useEffect(() => { applyColorTheme(loadThemeId()); }, []);
  // 端末の追加語句を出題プールへ反映（ソロや自分の出題に出る）。辞書は後読みなので読めてから。
  const updateWords = (list: CustomWord[]) => {
    setCustomWords(list); saveCustomWords(list);
    loadWords().then((m) => m.setExtraWords(list)).catch(() => {});
  };
  const updateGroups = (g: string[]) => { setCustomGroups(g); saveCustomGroups(g); };

  // ホームを出した後の空き時間に、各画面と辞書を先読みし、オンライン用の匿名サインインも始める。
  // 読み込みの失敗はここでは無視する（実際に開いた時にもう一度読みに行き、だめなら案内が出る）。
  useEffect(() => {
    whenIdle(() => {
      loadWords().then((m) => m.setExtraWords(loadCustomWords())).catch(() => {});
      for (const load of [loadSolo, loadLobby, loadRoom, loadRecords, loadWordEditor]) load().catch(() => {});
      if (!firebaseReady) { setAuthError(OFFLINE_MESSAGE); return; }
      import('./lib/firebase')
        .then((m) => m.ensureSignedIn())
        .then(setUid)
        .catch((e) => setAuthError(e instanceof Error ? e.message : 'サインインに失敗しました'));
    });
  }, []);

  if (view === 'solo') {
    return (
      <Suspense fallback={<ScreenLoading />}>
        <SoloGame onExit={() => setView('home')} />
      </Suspense>
    );
  }

  if (view === 'lobby') {
    if (!uid) return <AuthGate error={authError} onBack={() => setView('home')} />;
    return (
      <Suspense fallback={<ScreenLoading />}>
        <Lobby
          uid={uid}
          name={name}
          setName={setName}
          onJoined={(id) => {
            setRoomId(id);
            setView('room');
          }}
          onBack={() => setView('home')}
        />
      </Suspense>
    );
  }

  if (view === 'room' && roomId && uid) {
    return (
      <Suspense fallback={<ScreenLoading />}>
        <OnlineRoom
          roomId={roomId}
          uid={uid}
          onLeave={() => {
            setRoomId(null);
            setView('lobby');
          }}
        />
      </Suspense>
    );
  }

  // ホーム
  const scores = loadScores();
  const bestKps = scores.reduce((m, r) => Math.max(m, r.kps || 0), 0);
  const bestScore = scores.reduce((m, r) => Math.max(m, r.score || 0), 0);
  // 主役（遊ぶ）と脇役（整える・振り返る）で大きさを分ける。
  const playNav = [
    { k: 'ソロ', d: 'CPUとのバトル／制限時間のタイムアタック', onClick: () => setView('solo'), Icon: Swords, loading: false },
    {
      k: 'オンライン対戦',
      d: firebaseReady ? '最大16人。ルームを作るかコードで参加' : 'この環境では未設定（ソロのみ遊べます）',
      onClick: () => setView('lobby'),
      Icon: Users,
      loading: firebaseReady && !uid && !authError,
    },
  ];
  const subNav = [
    { k: 'プレイヤー設定', Icon: Settings, onClick: () => setShowSettings(true) },
    { k: `語句を追加（${customWords.length}）`, Icon: BookPlus, onClick: () => setShowWords(true) },
    { k: '記録・ランキング', Icon: Trophy, onClick: () => setShowRecords(true) },
  ];
  return (
    <div className="min-h-screen bg-transparent text-text flex flex-col items-center justify-center px-6 py-10 relative overflow-hidden">
      {/* 背景の巨大な淡い「打」 */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none select-none text-primary"
        style={{ fontFamily: "'Hiragino Mincho ProN','Yu Mincho',serif", fontWeight: 700, fontSize: 'min(80vh,680px)', lineHeight: 1, opacity: 0.035 }}
        aria-hidden
      >
        打
      </div>

      {/* ワードマーク */}
      <div className="relative z-10 text-center">
        <div className="ui-eyebrow" style={{ letterSpacing: '0.42em' }}>日本語タイピング・バトルロワイヤル</div>
        <h1 className="font-tech font-bold text-text mt-4" style={{ fontSize: 'clamp(48px,8vw,104px)', lineHeight: 0.92, letterSpacing: '0.06em', textShadow: '0 0 60px var(--glow)' }}>
          TYPE<br /><span className="text-primary">ROYALE</span>
        </h1>
      </div>

      {/* 遊ぶ（主役） */}
      <div className="relative z-10 grid gap-3 mt-11 w-full max-w-[680px] sm:grid-cols-2">
        {playNav.map(({ k, d, onClick, Icon, loading }, i) => (
          <button
            key={k}
            type="button"
            onClick={onClick}
            className="group text-left rounded-2xl p-5 border transition-all hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
              borderColor: i === 0 ? 'rgb(var(--ac-400) / 0.6)' : 'var(--line)',
              background: i === 0 ? 'linear-gradient(160deg, rgb(var(--ac-400) / 0.16), rgb(var(--ac-400) / 0.04))' : 'rgb(var(--n-50) / 0.03)',
              boxShadow: i === 0 ? '0 18px 40px -24px var(--glow)' : 'none',
              outlineColor: 'rgb(var(--ac-300))',
            }}
          >
            <div className="flex items-center justify-between">
              <span
                className="w-11 h-11 rounded-xl flex items-center justify-center"
                style={{ background: i === 0 ? 'rgb(var(--ac-400) / 0.2)' : 'rgb(var(--n-50) / 0.06)', color: i === 0 ? 'rgb(var(--ac-300))' : 'rgb(var(--n-300))' }}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Icon className="w-5 h-5" />}
              </span>
              <ChevronRight className="w-5 h-5 text-muted transition-transform group-hover:translate-x-0.5" />
            </div>
            <div className="text-xl font-bold text-text mt-4">{k}</div>
            <div className="text-sm text-muted mt-1 leading-relaxed">{d}</div>
          </button>
        ))}
      </div>

      {/* 整える・振り返る（脇役） */}
      <div className="relative z-10 flex flex-wrap justify-center gap-2 mt-3 w-full max-w-[680px]">
        {subNav.map(({ k, Icon, onClick }) => (
          <button key={k} type="button" onClick={onClick} className="ui-btn-secondary h-11 px-4 text-sm flex-1 min-w-[180px]">
            <Icon className="w-4 h-4 text-muted" />{k}
          </button>
        ))}
      </div>

      {/* 自分の記録 */}
      <div className="relative z-10 flex gap-10 mt-10">
        <HomeStat label="最高KPS" value={bestKps ? bestKps.toFixed(1) : '—'} />
        <HomeStat label="プレイ回数" value={String(scores.length)} />
        <HomeStat label="最高スコア" value={bestScore ? String(bestScore) : '—'} />
      </div>

      {/* 未設定（firebaseReady=false）はカードに書いてあるので、ここでは本当の接続エラーだけ出す */}
      {authError && firebaseReady && <p className="text-incoming text-sm mt-6 relative z-10">{authError}</p>}
      {showSettings && <PlayerSettings onClose={() => setShowSettings(false)} />}
      <Suspense fallback={null}>
        {showRecords && <RecordsBoard onClose={() => setShowRecords(false)} />}
        {showWords && (
          <WordEditor
            words={customWords}
            onChange={updateWords}
            onClose={() => setShowWords(false)}
            title="語句を追加（この端末）"
            note="ここで追加した語句は、この端末のソロや自分の出題に出ます。自作テーマを作って語句を振り分けると、出題テーマとして個別に選べます。"
            groups={customGroups}
            onGroupsChange={updateGroups}
          />
        )}
      </Suspense>
    </div>
  );
}

// 画面の読み込み待ち（先読みが間に合わなかった時だけ一瞬出る）。
const ScreenLoading = () => (
  <div className="min-h-screen bg-transparent text-text flex flex-col items-center justify-center gap-4">
    <Loader2 className="w-8 h-8 animate-spin text-primary" />
    <p className="text-muted text-sm">読み込み中…</p>
  </div>
);

const HomeStat = ({ label, value }: { label: string; value: string }) => (
  <div className="text-center leading-none">
    <div className="font-tech text-xs tracking-[0.16em] text-muted">{label}</div>
    <div className="font-tech text-[26px] font-semibold tabular-nums text-text mt-1.5">{value}</div>
  </div>
);

const AuthGate = ({ error, onBack }: { error: string; onBack: () => void }) => (
  <div className="min-h-screen bg-transparent text-text flex flex-col items-center justify-center gap-4">
    {error ? (
      <>
        <p className="text-incoming">{error}</p>
        <button onClick={onBack} className="tr-btn-ghost px-6 py-2">戻る</button>
      </>
    ) : (
      <>
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-muted text-sm">接続中…</p>
      </>
    )}
  </div>
);
