import { useState } from 'react';
import { Swords, LogIn, Plus, Loader2, ArrowLeft } from 'lucide-react';
import { createRoom, joinRoom } from '../lib/room';

interface LobbyProps {
  uid: string;
  name: string;
  setName: (n: string) => void;
  onJoined: (roomId: string) => void;
  onBack: () => void;
}

// ロビー画面: 名前入力 → ルーム作成 or コードで参加。
export default function Lobby({ uid, name, setName, onJoined, onBack }: LobbyProps) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    setBusy(true);
    setError('');
    try {
      const roomId = await createRoom(uid, name.trim() || 'Host');
      onJoined(roomId);
    } catch (e) {
      setError(e instanceof Error ? e.message : '作成に失敗しました');
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    const roomId = code.trim().toUpperCase();
    if (roomId.length < 4) {
      setError('ルームコードを入力してください');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await joinRoom(roomId, uid, name.trim() || 'Player');
      onJoined(roomId);
    } catch (e) {
      setError(e instanceof Error ? e.message : '参加に失敗しました');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-transparent text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        <button onClick={onBack} className="mb-6 text-gray-500 hover:text-gray-300 flex items-center gap-1 text-sm">
          <ArrowLeft className="w-4 h-4" /> 戻る
        </button>

        <div className="flex items-center gap-3 mb-8">
          <Swords className="text-cyan-400 w-8 h-8" />
          <h1 className="text-2xl font-black tracking-widest">ONLINE LOBBY</h1>
        </div>

        <label className="block text-xs text-gray-500 mb-1">プレイヤー名</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={16}
          placeholder="名無しさん"
          className="w-full bg-neutral-900 border border-white/10 rounded-lg px-4 py-3 mb-6 outline-none focus:border-cyan-500 transition-colors"
        />

        <button
          onClick={handleCreate}
          disabled={busy}
          className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg px-4 py-3 font-bold flex items-center justify-center gap-2 mb-6 transition-colors"
        >
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
          ルームを作成
        </button>

        <div className="flex items-center gap-3 mb-6 text-gray-600 text-xs">
          <div className="flex-1 h-px bg-white/10" />
          OR
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <label className="block text-xs text-gray-500 mb-1">ルームコードで参加</label>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={4}
            placeholder="ABCD"
            className="flex-1 bg-neutral-900 border border-white/10 rounded-lg px-4 py-3 outline-none focus:border-cyan-500 font-mono tracking-[0.3em] text-center uppercase transition-colors"
          />
          <button
            onClick={handleJoin}
            disabled={busy}
            className="bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 rounded-lg px-5 font-bold flex items-center gap-2 transition-colors"
          >
            <LogIn className="w-5 h-5" /> 参加
          </button>
        </div>

        {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
      </div>
    </div>
  );
}
