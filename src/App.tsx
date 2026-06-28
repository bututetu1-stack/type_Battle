import { useEffect, useState } from 'react';
import { Swords, User, Globe, Loader2, Settings, BookPlus } from 'lucide-react';
import { ensureSignedIn } from './lib/firebase';
import SoloGame from './components/SoloGame';
import Lobby from './components/Lobby';
import OnlineRoom from './components/OnlineRoom';
import PlayerSettings from './components/PlayerSettings';
import WordEditor from './components/WordEditor';
import { applyColorTheme, loadThemeId } from './lib/theme';
import { loadCustomWords, saveCustomWords, type CustomWord } from './lib/customwords';
import { setExtraWords } from './lib/words';

type View = 'home' | 'solo' | 'lobby' | 'room';

export default function App() {
  const [view, setView] = useState<View>('home');
  const [uid, setUid] = useState<string | null>(null);
  const [authError, setAuthError] = useState('');
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showWords, setShowWords] = useState(false);
  const [customWords, setCustomWords] = useState<CustomWord[]>(() => loadCustomWords());

  // 起動時に保存済みカラーテーマを body 背景へ適用（全画面共通）。
  useEffect(() => { applyColorTheme(loadThemeId()); }, []);
  // 起動時に端末の追加語句を出題プールへ反映（ソロや自分の出題に出る）。
  useEffect(() => { setExtraWords(loadCustomWords()); }, []);
  const updateWords = (list: CustomWord[]) => {
    setCustomWords(list); saveCustomWords(list); setExtraWords(list);
  };

  // オンライン用に匿名サインイン（バックグラウンドで先行実行）。
  useEffect(() => {
    ensureSignedIn()
      .then(setUid)
      .catch((e) => setAuthError(e instanceof Error ? e.message : 'サインインに失敗しました'));
  }, []);

  if (view === 'solo') {
    return <SoloGame onExit={() => setView('home')} />;
  }

  if (view === 'lobby') {
    if (!uid) return <AuthGate error={authError} onBack={() => setView('home')} />;
    return (
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
    );
  }

  if (view === 'room' && roomId && uid) {
    return (
      <OnlineRoom
        roomId={roomId}
        uid={uid}
        onLeave={() => {
          setRoomId(null);
          setView('lobby');
        }}
      />
    );
  }

  // ホーム
  return (
    <div className="min-h-screen bg-transparent text-white flex flex-col items-center justify-center p-6">
      <Swords className="w-20 h-20 text-cyan-500 mb-6" />
      <h1 className="text-5xl font-black tracking-widest mb-2">TYPE ROYALE</h1>
      <p className="text-gray-500 mb-12 tracking-wide">タイピング・バトルロワイヤル</p>

      <div className="flex flex-col gap-4 w-full max-w-xs">
        <button
          onClick={() => setView('solo')}
          className="bg-neutral-800 hover:bg-neutral-700 rounded-xl px-6 py-4 font-bold flex items-center justify-center gap-3 transition-colors"
        >
          <User className="w-5 h-5" /> ソロ <span className="text-xs text-gray-400">(練習・設定変更)</span>
        </button>
        <button
          onClick={() => setView('lobby')}
          className="bg-cyan-600 hover:bg-cyan-500 rounded-xl px-6 py-4 font-bold flex items-center justify-center gap-3 transition-colors"
        >
          {uid ? <Globe className="w-5 h-5" /> : <Loader2 className="w-5 h-5 animate-spin" />} オンライン対戦
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="bg-neutral-800/70 hover:bg-neutral-700 rounded-xl px-6 py-3 font-bold flex items-center justify-center gap-2 transition-colors text-gray-300"
        >
          <Settings className="w-5 h-5" /> プレイヤー設定
        </button>
        <button
          onClick={() => setShowWords(true)}
          className="bg-neutral-800/70 hover:bg-neutral-700 rounded-xl px-6 py-3 font-bold flex items-center justify-center gap-2 transition-colors text-gray-300"
        >
          <BookPlus className="w-5 h-5" /> 語句を追加 <span className="text-xs text-gray-500">({customWords.length})</span>
        </button>
      </div>

      {authError && <p className="text-red-400 text-sm mt-6">{authError}</p>}
      {showSettings && <PlayerSettings onClose={() => setShowSettings(false)} />}
      {showWords && (
        <WordEditor
          words={customWords}
          onChange={updateWords}
          onClose={() => setShowWords(false)}
          title="語句を追加（この端末）"
          note="ここで追加した語句は、この端末のソロや自分の出題に出ます（テーマ『追加した語句』でも遊べます）。"
        />
      )}
    </div>
  );
}

const AuthGate = ({ error, onBack }: { error: string; onBack: () => void }) => (
  <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center gap-4">
    {error ? (
      <>
        <p className="text-red-400">{error}</p>
        <button onClick={onBack} className="bg-neutral-800 hover:bg-neutral-700 rounded-lg px-6 py-2">
          戻る
        </button>
      </>
    ) : (
      <>
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        <p className="text-gray-500 text-sm">接続中…</p>
      </>
    )}
  </div>
);
