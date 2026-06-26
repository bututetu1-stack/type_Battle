import { useEffect, useState } from 'react';
import { Swords, Copy, Check, LogOut, Play, Loader2, Crown, Users } from 'lucide-react';
import {
  subscribeRoom,
  setupPresence,
  leaveRoom,
  startGame,
  setRoomCategory,
  type RoomSnapshot,
} from '../lib/room';
import { THEMES } from '../lib/words';
import OnlineGame from './OnlineGame';

interface OnlineRoomProps {
  roomId: string;
  uid: string;
  onLeave: () => void;
}

// ルーム購読 + 待機画面。status が playing/finished になったら OnlineGame を描画。
export default function OnlineRoom({ roomId, uid, onLeave }: OnlineRoomProps) {
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    setupPresence(roomId, uid).catch(() => {});
    const unsub = subscribeRoom(roomId, setSnap);
    return () => unsub();
  }, [roomId, uid]);

  // 再戦などで待機状態に戻ったら「開始中」表示を解除する。
  // （これを怠ると一度開始したホストのボタンが回り続けて再開始できない＝ロード地獄）
  useEffect(() => {
    if (snap?.meta?.status === 'waiting') setStarting(false);
  }, [snap?.meta?.status]);

  const handleLeave = async () => {
    await leaveRoom(roomId, uid).catch(() => {});
    onLeave();
  };

  const copyCode = () => {
    navigator.clipboard?.writeText(roomId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (!snap) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (!snap.meta) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center gap-4">
        <p className="text-gray-400">ルームが閉じられました</p>
        <button onClick={onLeave} className="bg-cyan-600 hover:bg-cyan-500 rounded-lg px-6 py-2 font-bold">
          ロビーに戻る
        </button>
      </div>
    );
  }

  const { meta, players } = snap;

  // 対戦中／決着 → ゲーム画面へ。
  if (meta.status === 'playing' || meta.status === 'finished') {
    return (
      <OnlineGame
        roomId={roomId}
        uid={uid}
        seed={meta.seed}
        startAt={meta.startAt}
        status={meta.status}
        hostUid={meta.hostUid}
        category={meta.category || 'all'}
        players={players}
        onExit={handleLeave}
      />
    );
  }

  // 待機画面
  const playerList = Object.entries(players);
  const isHost = meta.hostUid === uid;

  const handleStart = async () => {
    setStarting(true);
    await startGame(roomId).catch(() => setStarting(false));
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <Swords className="text-cyan-400 w-7 h-7" />
          <h1 className="text-2xl font-black tracking-widest">WAITING ROOM</h1>
        </div>

        {/* ルームコード */}
        <div className="bg-neutral-900 border border-white/10 rounded-xl p-5 mb-6 text-center">
          <p className="text-xs text-gray-500 mb-1">ルームコード（友達に共有）</p>
          <div className="flex items-center justify-center gap-3">
            <span className="text-4xl font-black font-mono tracking-[0.3em] text-cyan-300">{roomId}</span>
            <button onClick={copyCode} className="text-gray-400 hover:text-white">
              {copied ? <Check className="w-5 h-5 text-green-400" /> : <Copy className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* 参加者一覧 */}
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
          <Users className="w-4 h-4" /> 参加者 {playerList.length} / {meta.maxPlayers}
        </div>
        <div className="bg-neutral-900/60 rounded-xl border border-white/10 mb-6 divide-y divide-white/5 max-h-64 overflow-y-auto">
          {playerList.map(([id, p]) => (
            <div key={id} className="flex items-center justify-between px-4 py-2.5">
              <span className="flex items-center gap-2">
                {id === meta.hostUid && <Crown className="w-4 h-4 text-yellow-400" />}
                <span className={id === uid ? 'text-cyan-300 font-bold' : ''}>{p.name}</span>
                {id === uid && <span className="text-xs text-gray-600">(あなた)</span>}
              </span>
              <span className={`w-2 h-2 rounded-full ${p.connected ? 'bg-green-500' : 'bg-gray-600'}`} />
            </div>
          ))}
        </div>

        {/* 出題テーマ（ホストが選択） */}
        <div className="mb-6">
          <div className="text-xs text-gray-500 mb-1.5">出題テーマ {isHost ? '（ホストが選択）' : ''}</div>
          <div className="flex flex-wrap gap-1.5">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => isHost && setRoomCategory(roomId, t.id)}
                disabled={!isHost}
                className={`px-2.5 py-1 rounded-full text-xs font-bold transition-colors ${
                  (meta.category || 'all') === t.id
                    ? 'bg-cyan-600 text-white'
                    : 'bg-neutral-800 text-gray-400 ' + (isHost ? 'hover:bg-neutral-700' : 'opacity-60')
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* 操作 */}
        <div className="flex gap-3">
          <button
            onClick={handleLeave}
            className="bg-neutral-800 hover:bg-neutral-700 rounded-lg px-4 py-3 font-bold flex items-center gap-2"
          >
            <LogOut className="w-5 h-5" /> 退室
          </button>
          {isHost ? (
            <button
              onClick={handleStart}
              disabled={starting}
              className="flex-1 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg px-4 py-3 font-bold flex items-center justify-center gap-2"
            >
              {starting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
              ゲーム開始
            </button>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
              ホストの開始を待っています…
            </div>
          )}
        </div>
        {isHost && <p className="text-xs text-gray-600 mt-3 text-center">※ 1人でも開始できます（動作確認用）</p>}
      </div>
    </div>
  );
}
