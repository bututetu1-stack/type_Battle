import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ensureSignedIn } from './lib/firebase';
import SoloGame from './components/SoloGame';
import Lobby from './components/Lobby';
import OnlineRoom from './components/OnlineRoom';
import PlayerSettings from './components/PlayerSettings';
import WordEditor from './components/WordEditor';
import RecordsBoard from './components/RecordsBoard';
import { applyColorTheme, loadThemeId } from './lib/theme';
import { loadCustomWords, saveCustomWords, loadCustomGroups, saveCustomGroups, type CustomWord } from './lib/customwords';
import { setExtraWords } from './lib/words';
import { loadScores } from './lib/scores';

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
  // 起動時に端末の追加語句を出題プールへ反映（ソロや自分の出題に出る）。
  useEffect(() => { setExtraWords(loadCustomWords()); }, []);
  const updateWords = (list: CustomWord[]) => {
    setCustomWords(list); saveCustomWords(list); setExtraWords(list);
  };
  const updateGroups = (g: string[]) => { setCustomGroups(g); saveCustomGroups(g); };

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
  const scores = loadScores();
  const bestKps = scores.reduce((m, r) => Math.max(m, r.kps || 0), 0);
  const bestScore = scores.reduce((m, r) => Math.max(m, r.score || 0), 0);
  const homeNav = [
    { k: 'ソロ', d: 'CPU戦・タイムアタック', onClick: () => setView('solo'), accent: true, loading: false },
    { k: 'オンライン対戦', d: '最大16人 ロビー/ルーム', onClick: () => setView('lobby'), accent: false, loading: !uid },
    { k: 'プレイヤー設定', d: '名前・カラーテーマ・キー', onClick: () => setShowSettings(true), accent: false, loading: false },
    { k: '語句を追加', d: `お題の単語を登録（${customWords.length}）`, onClick: () => setShowWords(true), accent: false, loading: false },
    { k: '🏆 記録', d: 'ランキング / 統計', onClick: () => setShowRecords(true), accent: false, loading: false },
  ];
  return (
    <div className="min-h-screen bg-transparent text-text flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* 背景の巨大な淡い「打」 */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none select-none text-primary"
        style={{ fontFamily: "'Hiragino Mincho ProN','Yu Mincho',serif", fontWeight: 700, fontSize: 'min(80vh,680px)', lineHeight: 1, opacity: 0.04 }}
      >
        打
      </div>

      {/* ワードマーク */}
      <div className="relative z-10 text-center">
        <div className="font-tech text-muted mb-3" style={{ fontSize: 12, letterSpacing: '0.5em' }}>日本語タイピング・バトルロワイヤル</div>
        <div className="font-tech font-bold text-text" style={{ fontSize: 'clamp(44px,9vw,110px)', lineHeight: 0.95, letterSpacing: '0.08em', textShadow: '0 0 50px var(--glow)' }}>
          TYPE<br /><span className="text-primary">ROYALE</span>
        </div>
        <div className="mx-auto mt-5 bg-primary" style={{ width: 64, height: 2, boxShadow: '0 0 12px var(--glow)' }} />
      </div>

      {/* ナビカード */}
      <div className="relative z-10 grid gap-3.5 mt-10 justify-center" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 200px))', maxWidth: 660 }}>
        {homeNav.map((c) => (
          <button
            key={c.k}
            onClick={c.onClick}
            className="text-left rounded-2xl px-5 py-4 border transition-all hover:-translate-y-0.5 hover:border-primary"
            style={{
              borderColor: c.accent ? 'var(--primary)' : 'var(--line)',
              background: c.accent ? 'var(--surface2)' : 'var(--surface)',
              boxShadow: c.accent ? '0 0 24px -8px var(--glow)' : 'none',
            }}
          >
            <div className="flex items-center gap-2">
              {c.loading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                : <span className="rounded-sm" style={{ width: 8, height: 8, background: c.accent ? 'var(--primary)' : 'var(--muted)', boxShadow: c.accent ? '0 0 8px var(--primary)' : 'none' }} />}
              <span className="text-base font-semibold text-text">{c.k}</span>
            </div>
            <div className="text-xs text-muted mt-2 leading-relaxed">{c.d}</div>
          </button>
        ))}
      </div>

      {/* スタット帯 */}
      <div className="relative z-10 flex gap-7 mt-9 font-tech">
        <HomeStat label="BEST KPS" value={bestKps ? bestKps.toFixed(1) : '—'} color="var(--primary)" />
        <HomeStat label="総プレイ" value={String(scores.length)} color="var(--text)" />
        <HomeStat label="最高スコア" value={bestScore ? String(bestScore) : '—'} color="var(--charge)" />
      </div>

      {authError && <p className="text-incoming text-sm mt-6 relative z-10">{authError}</p>}
      {showSettings && <PlayerSettings onClose={() => setShowSettings(false)} />}
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
    </div>
  );
}

const HomeStat = ({ label, value, color }: { label: string; value: string; color: string }) => (
  <div className="text-center">
    <div className="text-muted" style={{ fontSize: 9, letterSpacing: '0.16em' }}>{label}</div>
    <div className="font-bold" style={{ fontSize: 20, color }}>{value}</div>
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
