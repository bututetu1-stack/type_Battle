import { useState } from 'react';
import { Swords, LogIn, Plus, Loader2, ArrowLeft, Users } from 'lucide-react';
import { createRoom, joinRoom } from '../lib/room';
import { Field, IconBtn } from './ui';

interface LobbyProps {
  uid: string;
  name: string;
  setName: (n: string) => void;
  onJoined: (roomId: string) => void;
  onBack: () => void;
}

// 入力欄（ソロの結果画面の名前欄と同じ見た目）。
const inputStyle = { background: 'rgb(var(--n-950) / 0.6)', border: '1px solid var(--line)' };

// ロビー画面: 名前入力 → ルーム作成 or コードで参加。
export default function Lobby({ uid, name, setName, onJoined, onBack }: LobbyProps) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  // エラーは、どちらの操作で起きたかを覚えて、そのカードの下に出す。
  const [error, setError] = useState<{ on: 'create' | 'join'; text: string } | null>(null);

  const handleCreate = async () => {
    setBusy('create');
    setError(null);
    try {
      const roomId = await createRoom(uid, name.trim() || 'Host');
      onJoined(roomId);
    } catch (e) {
      setError({ on: 'create', text: e instanceof Error ? e.message : '作成に失敗しました' });
      setBusy(null);
    }
  };

  const handleJoin = async () => {
    const roomId = code.trim().toUpperCase();
    if (roomId.length < 4) {
      setError({ on: 'join', text: '4文字のルームコードを入力してください' });
      return;
    }
    setBusy('join');
    setError(null);
    try {
      await joinRoom(roomId, uid, name.trim() || 'Player');
      onJoined(roomId);
    } catch (e) {
      setError({ on: 'join', text: e instanceof Error ? e.message : '参加に失敗しました' });
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-transparent text-text flex flex-col">
      <header
        className="h-16 border-b flex items-center px-5 gap-3"
        style={{ borderColor: 'var(--line)', background: 'rgb(var(--n-950) / 0.55)', backdropFilter: 'blur(8px)' }}
      >
        <IconBtn label="ホームへ戻る" onClick={onBack}><ArrowLeft className="w-5 h-5" /></IconBtn>
        <Swords className="w-5 h-5 text-cyan-400 shrink-0" />
        <h1 className="font-tech text-lg font-bold tracking-[0.16em] text-text whitespace-nowrap">TYPE ROYALE</h1>
        <span className="font-tech text-xs font-semibold tracking-[0.2em] text-muted mt-0.5">ONLINE</span>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-[720px] flex flex-col gap-7">
          <div>
            <div className="ui-eyebrow">ONLINE</div>
            <h2 className="mt-1.5 text-[28px] leading-tight font-bold text-text">オンライン対戦</h2>
            <p className="text-[15px] text-muted mt-2 leading-relaxed">
              ルームを作ってコードを友達に伝えるか、もらったコードで参加します。最大16人で、CPU を混ぜることもできます。
            </p>
          </div>

          <Field label="表示名" note="ルームの全員に見える名前（16文字まで）">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={16}
              placeholder="名無しさん"
              aria-label="表示名"
              className="w-full h-12 rounded-xl px-4 text-base text-text outline-none focus:ring-2 focus:ring-cyan-400/60"
              style={inputStyle}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* ルームを作る（主役） */}
            <section
              className="rounded-2xl p-5 flex flex-col gap-5 border"
              style={{ borderColor: 'rgb(var(--ac-400) / 0.6)', background: 'linear-gradient(160deg, rgb(var(--ac-400) / 0.14), rgb(var(--ac-400) / 0.03))' }}
            >
              <div className="flex items-start gap-3">
                <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgb(var(--ac-400) / 0.2)', color: 'rgb(var(--ac-300))' }}>
                  <Plus className="w-5 h-5" />
                </span>
                <div>
                  <div className="text-[17px] font-bold text-text">ルームを作る</div>
                  <div className="text-sm text-muted mt-0.5 leading-snug">あなたがホスト。ルールを決めて、全員そろったら開始します</div>
                </div>
              </div>
              <button type="button" onClick={handleCreate} disabled={busy !== null} className="ui-btn-primary h-12 text-base mt-auto disabled:opacity-60">
                {busy === 'create' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                ルームを作成
              </button>
              {/* エラーの行は両方のカードで同じ高さを確保し、ボタンの高さがずれないようにする */}
              <p role="alert" className="text-sm text-incoming -mt-3 min-h-5">{error?.on === 'create' ? error.text : ''}</p>
            </section>

            {/* コードで参加 */}
            <section className="ui-panel p-5 flex flex-col gap-5">
              <div className="flex items-start gap-3">
                <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgb(var(--n-50) / 0.06)', color: 'rgb(var(--n-300))' }}>
                  <Users className="w-5 h-5" />
                </span>
                <div>
                  <div className="text-[17px] font-bold text-text">コードで参加</div>
                  <div className="text-sm text-muted mt-0.5 leading-snug">ホストから聞いた4文字のルームコードを入力</div>
                </div>
              </div>
              <form className="flex gap-2 mt-auto" onSubmit={(e) => { e.preventDefault(); handleJoin(); }}>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={4}
                  placeholder="ABCD"
                  aria-label="ルームコード"
                  autoCapitalize="characters"
                  className="flex-1 min-w-0 h-12 rounded-xl px-3 font-tech text-xl font-semibold tracking-[0.4em] text-center uppercase text-text outline-none focus:ring-2 focus:ring-cyan-400/60"
                  style={inputStyle}
                />
                <button type="submit" disabled={busy !== null} className="ui-btn-secondary h-12 px-5 text-base disabled:opacity-60">
                  {busy === 'join' ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
                  参加
                </button>
              </form>
              <p role="alert" className="text-sm text-incoming -mt-3 min-h-5">{error?.on === 'join' ? error.text : ''}</p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
