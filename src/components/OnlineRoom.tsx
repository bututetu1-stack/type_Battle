import { useEffect, useState } from 'react';
import { Swords, Copy, Check, LogOut, Play, Loader2, Crown, Users, Bot, Plus, X } from 'lucide-react';
import {
  subscribeRoom,
  setupPresence,
  leaveRoom,
  startGame,
  setRoomCategory,
  setRoomMode,
  setRoomItemRate,
  setRoomHp,
  setRoomSpawnMs,
  setRoomAttackGauge,
  setRoomAttackCap,
  setRoomComboStep,
  setRoomBadgeCap,
  setRoomBadgeRate,
  setRoomGaugeMode,
  setRoomGaugeChars,
  setRoomComeback,
  setRoomItemsOn,
  setRoomCustomWords,
  addCpuPlayer,
  removeCpuPlayer,
  removeAllCpus,
  type RoomSnapshot,
} from '../lib/room';
import { THEMES, toggleThemeSelection } from '../lib/words';
import WordEditor from './WordEditor';
import { loadCustomWords } from '../lib/customwords';
import { loadItemPrefs, saveItemPrefs, CAT_META, USE_MODES, ITEM_CAT, type ItemPrefs } from '../lib/items';
import type { ItemType } from '../lib/types';
import OnlineGame, { ITEM_META, ITEM_EMOJI } from './OnlineGame';

interface OnlineRoomProps {
  roomId: string;
  uid: string;
  onLeave: () => void;
}

// 統合・削除してオンラインに出ないアイテム（一覧から除外）。
const HIDDEN_ITEMS = new Set<ItemType>(['shield', 'clear', 'heavy', 'mirror']);
// ボス戦専用アイテム（一覧で印を付ける）。
const BOSS_ONLY = new Set<ItemType>(['meteor', 'quake', 'regen', 'rally', 'focus']);
// オンライン専用アイテム（一覧で印を付ける）。
const ONLINE_ONLY = new Set<ItemType>(['reflect', 'overcharge', 'thunder', 'jammer', 'siphon', 'dazzle']);

// ルーム購読 + 待機画面。status が playing/finished になったら OnlineGame を描画。
export default function OnlineRoom({ roomId, uid, onLeave }: OnlineRoomProps) {
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [copied, setCopied] = useState(false);
  // アイテムの使い方（自分の設定。ソロと共通の localStorage に保存）。
  const [itemPrefs, setItemPrefs] = useState<ItemPrefs>(() => loadItemPrefs());
  const updatePrefs = (p: ItemPrefs) => { setItemPrefs(p); saveItemPrefs(p); };
  const [starting, setStarting] = useState(false);
  const [cpuStr, setCpuStr] = useState(5); // 追加するCPUの強さ(0〜10)
  const [showItems, setShowItems] = useState(false); // アイテム効果一覧の開閉
  const [showWords, setShowWords] = useState(false); // 追加語句エディタの開閉

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
    // ホストが抜けるときはCPUも片付けて、部屋が残らないようにする。
    if (snap?.meta?.hostUid === uid) await removeAllCpus(roomId).catch(() => {});
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
        mode={meta.mode === 'boss' ? 'boss' : 'royale'}
        bossUid={meta.bossUid || meta.hostUid}
        itemRate={typeof meta.itemRate === 'number' ? meta.itemRate : 30}
        hp={typeof meta.hp === 'number' ? meta.hp : 12}
        spawnMs={typeof meta.spawnMs === 'number' ? meta.spawnMs : 4000}
        attackGauge={typeof meta.attackGauge === 'number' ? meta.attackGauge : 5}
        attackCap={typeof meta.attackCap === 'number' ? meta.attackCap : 5}
        comboStep={typeof meta.comboStep === 'number' ? meta.comboStep : 5}
        badgeCap={typeof meta.badgeCap === 'number' ? meta.badgeCap : 4}
        badgeRate={typeof meta.badgeRate === 'number' ? meta.badgeRate : 25}
        gaugeMode={meta.gaugeMode === 'char' ? 'char' : 'word'}
        gaugeChars={typeof meta.gaugeChars === 'number' ? meta.gaugeChars : 16}
        comeback={typeof meta.comeback === 'number' ? meta.comeback : 2}
        itemsOn={meta.itemsOn !== false}
        customWords={Array.isArray(meta.customWords) ? meta.customWords : []}
        itemPrefs={itemPrefs}
        players={players}
        onExit={handleLeave}
      />
    );
  }

  // 待機画面
  const playerList = Object.entries(players);
  const cpuPlayers = playerList.filter(([, p]) => p.isCpu);
  const isHost = meta.hostUid === uid;

  const handleStart = async () => {
    setStarting(true);
    await startGame(roomId).catch(() => setStarting(false));
  };

  return (
    <div className="min-h-screen bg-transparent text-white flex flex-col items-center justify-center p-6">
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

        {/* ゲームモード（ホストが選択） */}
        <div className="mb-5">
          <div className="text-xs text-gray-500 mb-1.5">ゲームモード {isHost ? '（ホストが選択）' : ''}</div>
          <div className="grid grid-cols-2 gap-2">
            {([
              { id: 'royale', label: 'バトルロワイヤル', desc: '全員で勝ち残り' },
              { id: 'boss', label: 'ボス戦', desc: 'ホストがボス／みんなで討伐' },
            ] as const).map((m) => {
              const active = (meta.mode === 'boss' ? 'boss' : 'royale') === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => isHost && setRoomMode(roomId, m.id, meta.hostUid)}
                  disabled={!isHost}
                  className={`rounded-lg px-3 py-2 text-left border transition-colors ${
                    active
                      ? 'bg-cyan-600/20 border-cyan-500 text-cyan-200'
                      : 'bg-neutral-800 border-white/10 text-gray-400 ' + (isHost ? 'hover:bg-neutral-700' : 'opacity-60')
                  }`}
                >
                  <div className="text-sm font-bold flex items-center gap-1">
                    {m.id === 'boss' && <Crown className="w-3.5 h-3.5 text-yellow-400" />}
                    {m.label}
                  </div>
                  <div className="text-[10px] text-gray-500">{m.desc}</div>
                </button>
              );
            })}
          </div>
          {meta.mode === 'boss' && (
            <p className="text-[11px] text-yellow-300/80 mt-1.5">
              👑 ボスは {players[meta.bossUid || meta.hostUid]?.name ?? 'ホスト'}。他の参加者が協力して討伐します。
            </p>
          )}
        </div>

        {/* アイテムのON/OFF（ホストが選択） */}
        <div className="mb-3">
          <div className="text-xs text-gray-500 mb-1.5">アイテム {isHost ? '（ホストが選択）' : ''}</div>
          <div className="flex gap-1">
            {([[true, 'あり'], [false, 'なし']] as const).map(([on, lbl]) => (
              <button
                key={String(on)}
                onClick={() => isHost && setRoomItemsOn(roomId, on)}
                disabled={!isHost}
                className={`px-3 py-1 rounded text-xs font-bold transition-colors disabled:opacity-60 ${
                  (meta.itemsOn !== false) === on ? 'bg-fuchsia-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'
                }`}
              >
                {lbl}
              </button>
            ))}
            <span className="text-[10px] text-gray-600 self-center ml-1">なしでお宝・アイテムが出ません</span>
          </div>
        </div>

        {/* お宝(アイテム)出現率（ホストが選択） */}
        <div className={`mb-5 ${meta.itemsOn === false ? 'opacity-40 pointer-events-none' : ''}`}>
          <div className="text-xs text-gray-500 mb-1.5 flex items-center justify-between">
            <span>お宝（アイテム）出現率 {isHost ? '（ホストが選択）' : ''}</span>
            <span className="text-yellow-300 font-mono font-bold">
              {typeof meta.itemRate === 'number' ? meta.itemRate : 30}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={typeof meta.itemRate === 'number' ? meta.itemRate : 30}
            onChange={(e) => isHost && setRoomItemRate(roomId, Number(e.target.value))}
            disabled={!isHost || meta.itemsOn === false}
            className="w-full accent-yellow-500 disabled:opacity-60"
          />
          <p className="text-[10px] text-gray-600 mt-0.5">
            高いほどアイテムが多く出ます。出る内容は有利/不利で変化（不利なら防御・逆転、有利なら攻撃が出やすい）。
          </p>
        </div>

        {/* HP（積載上限）（ホストが選択） */}
        <div className="mb-5">
          <div className="text-xs text-gray-500 mb-1.5 flex items-center justify-between">
            <span>HP（積載上限） {isHost ? '（ホストが選択）' : ''}</span>
            <span className="text-cyan-300 font-mono font-bold">{typeof meta.hp === 'number' ? meta.hp : 12}</span>
          </div>
          <input
            type="range"
            min={6}
            max={24}
            step={1}
            value={typeof meta.hp === 'number' ? meta.hp : 12}
            onChange={(e) => isHost && setRoomHp(roomId, Number(e.target.value))}
            disabled={!isHost}
            className="w-full accent-cyan-500 disabled:opacity-60"
          />
        </div>

        {/* おじゃま供給の速さ（ホストが選択。小さいほど速い） */}
        <div className="mb-5">
          <div className="text-xs text-gray-500 mb-1.5 flex items-center justify-between">
            <span>自動供給の速さ {isHost ? '（ホストが選択）' : ''}</span>
            <span className="text-cyan-300 font-mono font-bold">{((typeof meta.spawnMs === 'number' ? meta.spawnMs : 4000) / 1000).toFixed(1)}秒</span>
          </div>
          <input
            type="range"
            min={1500}
            max={8000}
            step={250}
            // つまみ右ほど速く感じるよう、値を反転して表示する。
            value={9500 - (typeof meta.spawnMs === 'number' ? meta.spawnMs : 4000)}
            onChange={(e) => isHost && setRoomSpawnMs(roomId, 9500 - Number(e.target.value))}
            disabled={!isHost}
            className="w-full accent-cyan-500 disabled:opacity-60"
          />
          <p className="text-[10px] text-gray-600 mt-0.5">右ほど速い（おじゃま単語が早く積もります）。</p>
        </div>

        {/* ゲージ加算方式（ホストが選択） */}
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] text-gray-500">ゲージ加算方式</span>
          {([['word', 'ワード数'], ['char', '文字数']] as const).map(([m, lbl]) => (
            <button key={m} onClick={() => isHost && setRoomGaugeMode(roomId, m)} disabled={!isHost}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors disabled:opacity-60 ${(meta.gaugeMode === 'char' ? 'char' : 'word') === m ? 'bg-orange-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'}`}>
              {lbl}
            </button>
          ))}
          <span className="text-[9px] text-gray-600">{meta.gaugeMode === 'char' ? '長い単語ほど溜まる' : '1ワード=1'}</span>
        </div>

        {/* 攻撃の設定（ホストが選択） */}
        <div className="mb-5 grid grid-cols-3 gap-2">
          {([
            (meta.gaugeMode === 'char'
              ? { key: 'gauge', label: 'ゲージ(文字)', val: typeof meta.gaugeChars === 'number' ? meta.gaugeChars : 16, min: 6, max: 40, set: setRoomGaugeChars }
              : { key: 'gauge', label: 'ゲージ(クリア)', val: typeof meta.attackGauge === 'number' ? meta.attackGauge : 5, min: 2, max: 10, set: setRoomAttackGauge }),
            { key: 'cap', label: 'アタック上限', val: typeof meta.attackCap === 'number' ? meta.attackCap : 5, min: 2, max: 12, set: setRoomAttackCap },
            { key: 'step', label: '増加の連鎖数', val: typeof meta.comboStep === 'number' ? meta.comboStep : 5, min: 2, max: 15, set: setRoomComboStep },
            { key: 'badgeCap', label: 'バッジ上限', val: typeof meta.badgeCap === 'number' ? meta.badgeCap : 4, min: 0, max: 10, set: setRoomBadgeCap },
            { key: 'badgeRate', label: 'バッジ上昇率%', val: typeof meta.badgeRate === 'number' ? meta.badgeRate : 25, min: 0, max: 100, set: setRoomBadgeRate },
          ] as const).map((s) => (
            <div key={s.key} className="bg-neutral-900/60 border border-white/10 rounded-lg p-2">
              <div className="text-[10px] text-gray-500 mb-1 flex items-center justify-between">
                <span>{s.label}</span>
                <span className="text-orange-300 font-mono font-bold">{s.val}</span>
              </div>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={1}
                value={s.val}
                onChange={(e) => isHost && s.set(roomId, Number(e.target.value))}
                disabled={!isHost}
                className="w-full accent-orange-500 disabled:opacity-60"
              />
            </div>
          ))}
        </div>

        {/* 逆転補正（ホストが選択） */}
        <div className="mb-5 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-gray-500">逆転補正</span>
          {([[0, 'なし'], [1, '弱'], [2, '中'], [3, '強']] as const).map(([v, lbl]) => (
            <button key={v} onClick={() => isHost && setRoomComeback(roomId, v)} disabled={!isHost}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors disabled:opacity-60 ${(typeof meta.comeback === 'number' ? meta.comeback : 2) === v ? 'bg-emerald-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'}`}>
              {lbl}
            </button>
          ))}
          <span className="text-[9px] text-gray-600">劣勢ほど防御・逆転／優勢ほど攻撃（順位＋ピンチ度）</span>
        </div>

        {/* CPU追加（ホストのみ。royaleモード向け） */}
        {isHost && (
          <div className="mb-5 bg-neutral-900/60 border border-white/10 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-fuchsia-200 font-bold flex items-center gap-1"><Bot className="w-4 h-4" /> CPU を追加</span>
              <button
                onClick={() => addCpuPlayer(roomId, cpuStr / 10).catch(() => {})}
                disabled={playerList.length >= meta.maxPlayers}
                className="px-2 py-1 rounded bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-40 text-white text-[11px] font-bold flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> 追加
              </button>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] text-gray-400 shrink-0">強さ {cpuStr}</span>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={cpuStr}
                onChange={(e) => setCpuStr(Number(e.target.value))}
                className="flex-1 accent-fuchsia-500"
              />
            </div>
            {cpuPlayers.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {cpuPlayers.map(([id, p]) => (
                  <span key={id} className="inline-flex items-center gap-1 bg-neutral-800 rounded-full pl-2 pr-1 py-0.5 text-[11px] text-gray-300">
                    {p.name}
                    <span className="text-fuchsia-300 font-mono">{Math.round((p.str ?? 0.5) * 10)}</span>
                    <button onClick={() => removeCpuPlayer(roomId, id).catch(() => {})} className="text-gray-500 hover:text-red-400">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-gray-600">CPUはホストの端末でシミュレートされます（バトルロワイヤル向け）。</p>
            )}
          </div>
        )}

        {/* 出題テーマ（ホストが選択・複数選択可） */}
        <div className="mb-6">
          <div className="text-xs text-gray-500 mb-1.5">出題テーマ（複数選択可）{isHost ? '（ホストが選択）' : ''}</div>
          <div className="flex flex-wrap gap-1.5">
            {THEMES.map((t) => {
              const cat = meta.category || 'all';
              const sel = t.id === 'all' ? cat === 'all' || cat === '' : cat.split(',').includes(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => isHost && setRoomCategory(roomId, toggleThemeSelection(cat, t.id))}
                  disabled={!isHost}
                  className={`px-2.5 py-1 rounded-full text-xs font-bold transition-colors ${
                    sel
                      ? 'bg-cyan-600 text-white'
                      : 'bg-neutral-800 text-gray-400 ' + (isHost ? 'hover:bg-neutral-700' : 'opacity-60')
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* アイテムの使い方（自分の設定） */}
        <div className="mb-6 bg-neutral-900/60 border border-white/10 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-amber-200 font-bold">アイテムの使い方（自分用）</span>
            <button
              onClick={() => updatePrefs({ ...itemPrefs, autoFull: !itemPrefs.autoFull })}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                itemPrefs.autoFull ? 'bg-emerald-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'
              }`}
            >
              完全オート {itemPrefs.autoFull ? 'ON' : 'OFF'}
            </button>
          </div>
          {itemPrefs.autoFull ? (
            <p className="text-[10px] text-emerald-300/80">
              有利/不利を見て、いい感じのタイミングで自動発動します（手動 [Space] も可）。
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {CAT_META.map((c) => (
                <div key={c.key} className="flex items-center justify-between gap-2">
                  <span className={`text-[11px] font-bold ${c.color} w-8 shrink-0`}>{c.label}</span>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {USE_MODES.map((m) => (
                      <button
                        key={m.key}
                        onClick={() => updatePrefs({ ...itemPrefs, use: { ...itemPrefs.use, [c.key]: m.key } })}
                        title={m.desc}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                          itemPrefs.use[c.key] === m.key ? 'bg-cyan-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[9px] text-gray-600 leading-tight">
                新着=[Enter]手動 / 即時=拾った瞬間 / オート=良い時に自動 / 保持=1つ保持し被ったら新しい方を発動
              </p>
            </div>
          )}
        </div>

        {/* 追加語句（部屋共有。ホストが追加すると全員の出題に出る） */}
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setShowWords(true)}
            className="flex-1 bg-neutral-800/70 hover:bg-neutral-700 rounded-xl px-4 py-2.5 font-bold text-sm flex items-center justify-center gap-2 text-gray-200"
          >
            📚 語句を追加（部屋共有） <span className="text-xs text-gray-500">({Array.isArray(meta.customWords) ? meta.customWords.length : 0})</span>
            {!isHost && <span className="text-[10px] text-gray-500">閲覧のみ</span>}
          </button>
          {isHost && (
            <button
              onClick={() => {
                const local = loadCustomWords();
                if (local.length === 0) return;
                const cur = Array.isArray(meta.customWords) ? meta.customWords : [];
                const seen = new Set(cur.map((w) => w.display + '|' + w.reading));
                const merged = [...cur];
                for (const w of local) { const k = w.display + '|' + w.reading; if (!seen.has(k)) { seen.add(k); merged.push(w); } }
                setRoomCustomWords(roomId, merged);
              }}
              title="この端末に保存した追加語句を、まとめて部屋へ追加します"
              className="bg-fuchsia-700/80 hover:bg-fuchsia-600 rounded-xl px-3 py-2.5 font-bold text-xs text-white whitespace-nowrap"
            >
              端末の語句を一括追加
            </button>
          )}
        </div>

        {/* アイテム効果一覧（オンラインの効果。ボス専用・オンライン専用も表示） */}
        <div className="mb-6 bg-neutral-900/60 border border-white/10 rounded-xl">
          <button
            onClick={() => setShowItems((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-bold text-cyan-200"
          >
            <span>📖 アイテム効果一覧（オンライン）</span>
            <span className="text-gray-500">{showItems ? '▲ 閉じる' : '▼ 開く'}</span>
          </button>
          {showItems && (
            <div className="px-3 pb-3 flex flex-col gap-3 max-h-72 overflow-y-auto">
              {CAT_META.map((c) => {
                const list = (Object.keys(ITEM_CAT) as ItemType[]).filter(
                  (it) => ITEM_CAT[it] === c.key && !HIDDEN_ITEMS.has(it),
                );
                if (list.length === 0) return null;
                return (
                  <div key={c.key}>
                    <div className={`text-[11px] font-bold mb-1 ${c.color}`}>{c.label}</div>
                    <div className="flex flex-col gap-1">
                      {list.map((it) => (
                        <div key={it} className="flex items-start gap-2 text-[11px]">
                          <span className="text-base leading-none shrink-0">{ITEM_EMOJI[it]}</span>
                          <div>
                            <span className="font-bold text-gray-200">{ITEM_META[it].name}</span>
                            {BOSS_ONLY.has(it) && <span className="ml-1 text-[9px] text-yellow-300">[ボス]</span>}
                            {ONLINE_ONLY.has(it) && <span className="ml-1 text-[9px] text-fuchsia-300">[ONLINE]</span>}
                            <span className="text-gray-500"> — {ITEM_META[it].desc}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              <p className="text-[9px] text-gray-600">※ ソロとオンラインで効果が異なるアイテムがあります（上記はオンラインの効果）。</p>
            </div>
          )}
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

      {showWords && (
        <WordEditor
          words={Array.isArray(meta.customWords) ? meta.customWords : []}
          onChange={(list) => { if (isHost) setRoomCustomWords(roomId, list); }}
          onClose={() => setShowWords(false)}
          title="語句を追加（部屋共有）"
          readOnly={!isHost}
          note={isHost
            ? 'ここで追加した語句は、この部屋の全員の出題に出ます（テーマ『追加した語句』でも遊べます）。'
            : 'ホストが追加した、この部屋の共有語句です（閲覧のみ）。'}
        />
      )}
    </div>
  );
}
