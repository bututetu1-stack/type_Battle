import { useEffect, useRef, useState } from 'react';
import {
  Swords, Copy, Check, LogOut, Play, Loader2, Crown, Users, Bot, Plus, X, BookOpen, BookPlus,
  SlidersHorizontal, Gift, Hand, Gauge,
} from 'lucide-react';
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
  setRoomDisabledItems,
  setRoomExcludedThemes,
  setPlayerWords,
  addCpuPlayer,
  removeCpuPlayer,
  removeAllCpus,
  type RoomSnapshot,
} from '../lib/room';
import { THEMES, toggleThemeSelection } from '../lib/words';
import WordEditor from './WordEditor';
import { Seg, Field, Panel, CfgSlider, CfgSection } from './ui';
import { loadCustomWords } from '../lib/customwords';
import { loadItemPrefs, saveItemPrefs, CAT_META, USE_MODES, ITEM_CAT, ONLINE_ITEM_META as ITEM_META, ITEM_EMOJI, type ItemPrefs } from '../lib/items';
import type { ItemType } from '../lib/types';
import OnlineGame from './OnlineGame';
import { cpuKps } from '../lib/cpu';

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

// 部屋の設定値（未設定ならこの既定値。OnlineGame へ渡す値と同じ）。
const num = (v: unknown, def: number) => (typeof v === 'number' ? v : def);

// 待機画面全体の枠（ヘッダー＋本文）。読み込み中・部屋が閉じた時にも同じ枠を使う。
const Shell = ({ right, children }: { right?: React.ReactNode; children: React.ReactNode }) => (
  <div className="min-h-screen bg-transparent text-text flex flex-col">
    <header
      className="h-16 border-b flex items-center justify-between px-5 shrink-0"
      style={{ borderColor: 'var(--line)', background: 'rgb(var(--n-950) / 0.55)', backdropFilter: 'blur(8px)' }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <Swords className="w-5 h-5 text-cyan-400 shrink-0" />
        <h1 className="font-tech text-lg font-bold tracking-[0.16em] text-text whitespace-nowrap">TYPE ROYALE</h1>
        <span className="font-tech text-xs font-semibold tracking-[0.2em] text-muted mt-0.5 whitespace-nowrap">ONLINE</span>
      </div>
      {right}
    </header>
    {children}
  </div>
);

// ルーム購読 + 待機画面。status が playing/finished になったら OnlineGame を描画。
export default function OnlineRoom({ roomId, uid, onLeave }: OnlineRoomProps) {
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [copied, setCopied] = useState(false);
  // アイテムの使い方（自分の設定。ソロと共通の localStorage に保存）。
  const [itemPrefs, setItemPrefs] = useState<ItemPrefs>(() => loadItemPrefs());
  const updatePrefs = (p: ItemPrefs) => { setItemPrefs(p); saveItemPrefs(p); };
  const [starting, setStarting] = useState(false);
  const [cpuStr, setCpuStr] = useState(5); // 追加するCPUの強さ(0〜10)
  const [showWords, setShowWords] = useState(false); // 追加語句エディタの開閉

  const stopPresenceRef = useRef<() => void>(() => {});
  useEffect(() => {
    const stopPresence = setupPresence(roomId, uid);
    stopPresenceRef.current = stopPresence;
    const unsub = subscribeRoom(roomId, setSnap);
    return () => { unsub(); stopPresence(); };
  }, [roomId, uid]);
  // 端末の追加語句（「持ち寄る」用）。部屋の更新のたびに読み直さないよう最初に1回だけ読む。
  const [localWords] = useState(() => loadCustomWords());

  // 再戦などで待機状態に戻ったら「開始中」表示を解除する。
  // （これを怠ると一度開始したホストのボタンが回り続けて再開始できない＝ロード地獄）
  useEffect(() => {
    if (snap?.meta?.status === 'waiting') setStarting(false);
  }, [snap?.meta?.status]);

  const handleLeave = async () => {
    // ホストが抜けるときはCPUも片付けて、部屋が残らないようにする。
    if (snap?.meta?.hostUid === uid) await removeAllCpus(roomId).catch(() => {});
    stopPresenceRef.current(); // 退室の途中で再接続しても、自分の項目を作り直さないように先に止める
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
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted text-sm">ルームに接続中…</p>
        </div>
      </Shell>
    );
  }

  if (!snap.meta) {
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 text-center">
          <p className="text-lg font-bold text-text">このルームは閉じられました</p>
          <p className="text-sm text-muted -mt-2">ホストが退室したか、時間が経って片付けられました。</p>
          <button type="button" onClick={onLeave} className="ui-btn-primary h-12 px-7 text-base">ロビーに戻る</button>
        </div>
      </Shell>
    );
  }

  const { meta, players } = snap;

  // 部屋で実際に出題する追加語句 = ホストの共有語句 ＋ 全員が持ち寄った語句（重複除外）。
  // 全クライアントで同じ並びにするため、uid をソートして決定的に統合する（シード同期を維持）。
  const sharedWords = (() => {
    const out: { display: string; reading: string }[] = [];
    const seen = new Set<string>();
    const push = (w?: { display?: string; reading?: string }) => {
      if (!w || !w.display || !w.reading) return;
      const k = w.display + '|' + w.reading;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ display: w.display, reading: w.reading });
    };
    (Array.isArray(meta.customWords) ? meta.customWords : []).forEach(push);
    Object.keys(players).sort().forEach((id) => (players[id].words || []).forEach(push));
    return out;
  })();

  const excludedThemes = Array.isArray(meta.excludedThemes) ? meta.excludedThemes : (meta.kancolleOn === false ? ['kancolle'] : []);

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
        itemRate={num(meta.itemRate, 30)}
        hp={num(meta.hp, 12)}
        spawnMs={num(meta.spawnMs, 4000)}
        attackGauge={num(meta.attackGauge, 5)}
        attackCap={num(meta.attackCap, 5)}
        comboStep={num(meta.comboStep, 5)}
        badgeCap={num(meta.badgeCap, 4)}
        badgeRate={num(meta.badgeRate, 25)}
        gaugeMode={meta.gaugeMode === 'char' ? 'char' : 'word'}
        gaugeChars={num(meta.gaugeChars, 16)}
        comeback={num(meta.comeback, 2)}
        itemsOn={meta.itemsOn !== false}
        disabledItems={Array.isArray(meta.disabledItems) ? meta.disabledItems : []}
        excludedThemes={excludedThemes}
        customWords={sharedWords}
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
  const mode = meta.mode === 'boss' ? 'boss' : 'royale';
  const itemsOn = meta.itemsOn !== false;
  const gaugeMode = meta.gaugeMode === 'char' ? 'char' : 'word';
  const spawnMs = num(meta.spawnMs, 4000);
  const category = meta.category || 'all';
  const disabledItems = Array.isArray(meta.disabledItems) ? meta.disabledItems : [];
  const myWords = players[uid]?.words || [];
  const contributing = myWords.length > 0;

  const handleStart = async () => {
    setStarting(true);
    await startGame(roomId).catch(() => setStarting(false));
  };

  return (
    <Shell
      right={(
        <button type="button" onClick={handleLeave} className="ui-btn-secondary h-10 px-4 text-sm">
          <LogOut className="w-4 h-4" /> 退室
        </button>
      )}
    >
      <main className="w-full max-w-[1180px] mx-auto px-6 py-8 grid gap-6 lg:gap-10 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] items-start">
        {/* ── 左: ルームコード・参加者・開始（スクロールしても常に見える） ── */}
        <section className="lg:sticky lg:top-8 flex flex-col gap-5">
          <div>
            <div className="ui-eyebrow">ROOM</div>
            <h2 className="mt-1.5 text-[28px] leading-tight font-bold text-text [text-wrap:balance]">
              {isHost ? 'ルールを決めて開始' : 'まもなく開始'}
            </h2>
          </div>

          <div className="ui-panel px-5 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-text">ルームコード</span>
              <span className="text-xs text-muted">友達に伝えて参加してもらう</span>
            </div>
            <div className="flex items-center justify-between gap-3 mt-2">
              <span data-room-code={roomId} className="font-tech text-[44px] font-bold tracking-[0.28em] text-primary leading-none">{roomId}</span>
              <button type="button" onClick={copyCode} className="ui-btn-secondary h-10 px-3 text-sm shrink-0" aria-live="polite">
                {copied ? <><Check className="w-4 h-4 text-success" /> コピー済み</> : <><Copy className="w-4 h-4" /> コピー</>}
              </button>
            </div>
          </div>

          <div className="ui-panel px-5 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex items-center gap-2 text-sm font-semibold text-text"><Users className="w-4 h-4 text-muted" /> 参加者</span>
              <span className="font-tech text-sm tabular-nums text-muted">{playerList.length} / {meta.maxPlayers}</span>
            </div>
            <ul className="mt-2 max-h-[280px] overflow-y-auto">
              {playerList.map(([id, p]) => (
                <li key={id} className="flex items-center gap-2.5 py-2 border-t first:border-t-0" style={{ borderColor: 'var(--line)' }}>
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: p.connected === false ? 'rgb(var(--n-600))' : 'var(--success)' }}
                    title={p.connected === false ? '切断中' : '接続中'}
                  />
                  <span className={`truncate text-[15px] ${id === uid ? 'font-bold text-text' : 'text-text'}`}>{p.name}</span>
                  {id === uid && <span className="text-xs text-muted shrink-0">あなた</span>}
                  {p.isCpu && <span className="font-tech text-xs text-muted shrink-0" title={`約${cpuKps(p.str ?? 0.5).toFixed(1)}打/秒`}>強さ {Math.round((p.str ?? 0.5) * 10)}</span>}
                  <span className="ml-auto flex items-center gap-2 shrink-0">
                    {id === meta.hostUid && <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--charge)' }}><Crown className="w-3.5 h-3.5" />ホスト</span>}
                    {mode === 'boss' && id === (meta.bossUid || meta.hostUid) && <span className="text-xs font-semibold text-incoming">ボス</span>}
                    {isHost && p.isCpu && (
                      <button type="button" onClick={() => removeCpuPlayer(roomId, id).catch(() => {})} aria-label={`${p.name} を外す`} title="外す"
                        className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-text hover:bg-neutral-800">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {isHost ? (
            <div className="flex flex-col gap-2">
              <button type="button" onClick={handleStart} disabled={starting} className="ui-btn-primary h-14 text-lg disabled:opacity-60">
                {starting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" fill="currentColor" />}
                ゲーム開始
              </button>
              <p className="text-[13px] text-muted text-center">
                {playerList.length <= 1 ? '1人でも開始できます（動作確認用）' : `${playerList.length}人で開始します。5秒のカウントダウンのあと同時にスタート`}
              </p>
            </div>
          ) : (
            <div className="ui-panel px-5 py-4 flex items-center gap-3 text-[15px] text-muted">
              <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" />
              ホストの開始を待っています…
            </div>
          )}
        </section>

        {/* ── 右: ルール・出題・詳細（ホストが決める。参加者は見るだけ） ── */}
        <div className="flex flex-col gap-4 min-w-0">
          <Panel title="ルール" icon={<Swords className="w-4 h-4" />} aside={<span className="text-xs text-muted">{isHost ? 'ホストが決めます' : 'ホストが設定中（見るだけ）'}</span>}>
            <div className="flex flex-col gap-5">
              <Field
                label="ゲームモード"
                note={mode === 'boss' ? `ボスは ${players[meta.bossUid || meta.hostUid]?.name ?? 'ホスト'}。ほかの全員で討伐` : '全員で撃ち合い、最後の1人を目指す'}
              >
                <Seg label="ゲームモード" value={mode} disabled={!isHost} onChange={(m) => setRoomMode(roomId, m, meta.hostUid)}
                  options={[{ value: 'royale' as const, label: 'バトルロワイヤル' }, { value: 'boss' as const, label: 'ボス戦' }]} />
              </Field>
              <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
                <CfgSlider label="HP（積める量）" hint="山がこれを超えると脱落" value={num(meta.hp, 12)} display={String(num(meta.hp, 12))} min={6} max={24} step={1}
                  disabled={!isHost} onChange={(v) => setRoomHp(roomId, v)} />
                {/* つまみ右ほど速く感じるよう、値を反転して持つ（9500 − 間隔） */}
                <CfgSlider label="自動供給の速さ" hint="右ほど速い（単語が早く積もる）" value={9500 - spawnMs} display={`${(spawnMs / 1000).toFixed(1)}秒ごと`}
                  min={1500} max={8000} step={250} disabled={!isHost} onChange={(v) => setRoomSpawnMs(roomId, 9500 - v)} />
              </div>
            </div>
          </Panel>

          <Panel title="出題テーマ" icon={<BookOpen className="w-4 h-4" />} aside={<span className="text-xs text-muted">複数選べます</span>}>
            <div className="flex flex-wrap gap-2">
              {THEMES.map((t) => {
                const sel = t.id === 'all' ? category === 'all' || category === '' : category.split(',').includes(t.id);
                return (
                  <button key={t.id} type="button" data-on={sel} aria-pressed={sel} disabled={!isHost} className="ui-chip"
                    onClick={() => setRoomCategory(roomId, toggleThemeSelection(category, t.id))}>
                    {t.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 border-t pt-1" style={{ borderColor: 'var(--line)' }}>
              <CfgSection title="「すべて」に含めるテーマ" icon={<SlidersHorizontal className="w-4 h-4" />}
                aside={excludedThemes.length > 0 ? <span className="text-xs text-muted">{excludedThemes.length}個を除外中</span> : undefined}>
                <div className="flex flex-wrap gap-2">
                  {THEMES.filter((t) => t.id !== 'all' && t.id !== 'custom').map((t) => {
                    const off = excludedThemes.includes(t.id);
                    return (
                      <button key={t.id} type="button" className="ui-chip" data-off={off} aria-pressed={!off} disabled={!isHost}
                        title={off ? '「すべて」に含めない' : '「すべて」に含める'}
                        onClick={() => setRoomExcludedThemes(roomId, off ? excludedThemes.filter((x) => x !== t.id) : [...excludedThemes, t.id])}>
                        {!off && <Check className="w-3.5 h-3.5" />}{t.label}
                      </button>
                    );
                  })}
                </div>
              </CfgSection>
              <CfgSection title="追加した語句（部屋で共有）" icon={<BookPlus className="w-4 h-4" />}
                aside={<span className="font-tech text-xs tabular-nums text-muted">{sharedWords.length}語</span>}>
                <p className="text-sm text-muted leading-relaxed -mt-1">
                  ホストが登録した語句と、参加者が「持ち寄った」語句が全員の出題に混ざります（重複は自動で除外）。
                  テーマ「追加した語句」を選ぶと、それだけで遊べます。
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setShowWords(true)} className="ui-btn-secondary h-10 px-4 text-sm">
                    <BookPlus className="w-4 h-4" /> {isHost ? '共有の語句を編集' : '共有の語句を見る'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlayerWords(roomId, uid, contributing ? [] : localWords)}
                    disabled={!contributing && localWords.length === 0}
                    title="この端末に保存した追加語句を、全員の出題に持ち寄ります"
                    className="ui-btn-secondary h-10 px-4 text-sm disabled:opacity-50"
                  >
                    {contributing ? `持ち寄りをやめる（${myWords.length}語）` : `自分の語句を持ち寄る（${localWords.length}語）`}
                  </button>
                </div>
              </CfgSection>
            </div>
          </Panel>

          <Panel title="詳細設定" icon={<SlidersHorizontal className="w-4 h-4" />} aside={<span className="text-xs text-muted">{isHost ? '' : '見るだけ'}</span>}>
            <CfgSection title="攻撃・ゲージ" icon={<Gauge className="w-4 h-4" />}>
              <Field label="ゲージの溜まり方" note={gaugeMode === 'char' ? '長い単語ほど溜まる' : '1単語＝1ゲージ'}>
                <Seg label="ゲージの溜まり方" value={gaugeMode} disabled={!isHost} onChange={(m) => setRoomGaugeMode(roomId, m)}
                  options={[{ value: 'word' as const, label: '単語の数' }, { value: 'char' as const, label: '文字の数' }]} />
              </Field>
              <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
                {gaugeMode === 'word' ? (
                  <CfgSlider label="何単語で攻撃するか" value={num(meta.attackGauge, 5)} display={`${num(meta.attackGauge, 5)}単語`} min={2} max={10} step={1}
                    disabled={!isHost} onChange={(v) => setRoomAttackGauge(roomId, v)} />
                ) : (
                  <CfgSlider label="何文字で攻撃するか" value={num(meta.gaugeChars, 16)} display={`${num(meta.gaugeChars, 16)}文字`} min={6} max={40} step={1}
                    disabled={!isHost} onChange={(v) => setRoomGaugeChars(roomId, v)} />
                )}
                <CfgSlider label="1回の攻撃の上限" value={num(meta.attackCap, 5)} display={String(num(meta.attackCap, 5))} min={2} max={12} step={1}
                  disabled={!isHost} onChange={(v) => setRoomAttackCap(roomId, v)} />
                <CfgSlider label="攻撃が増える連鎖数" hint="この連鎖ごとに攻撃量が+1" value={num(meta.comboStep, 5)} display={`${num(meta.comboStep, 5)}連鎖`} min={2} max={15} step={1}
                  disabled={!isHost} onChange={(v) => setRoomComboStep(roomId, v)} />
                <CfgSlider label="バッジの上限" hint="撃破数による攻撃の補正の上限" value={num(meta.badgeCap, 4)} display={`${num(meta.badgeCap, 4)}枚`} min={0} max={10} step={1}
                  disabled={!isHost} onChange={(v) => setRoomBadgeCap(roomId, v)} />
                <CfgSlider label="バッジ1枚の攻撃上昇" value={num(meta.badgeRate, 25)} display={`${num(meta.badgeRate, 25)}%`} min={0} max={100} step={5}
                  disabled={!isHost} onChange={(v) => setRoomBadgeRate(roomId, v)} />
              </div>
              <Field label="逆転補正" note="劣勢ほど防御・逆転のアイテム、優勢ほど攻撃のアイテムが出る">
                <Seg label="逆転補正" value={num(meta.comeback, 2)} disabled={!isHost} onChange={(v) => setRoomComeback(roomId, v)}
                  options={([[0, 'なし'], [1, '弱'], [2, '中'], [3, '強']] as const).map(([v, l]) => ({ value: v, label: l }))} />
              </Field>
            </CfgSection>

            <CfgSection title="お宝・アイテム" icon={<Gift className="w-4 h-4" />}
              aside={!itemsOn ? <span className="text-xs text-muted">なし</span> : disabledItems.length > 0 ? <span className="text-xs text-muted">{disabledItems.length}個を外し中</span> : undefined}>
              <Field label="アイテム" note={itemsOn ? undefined : 'お宝もアイテムも出ません'}>
                <Seg label="アイテム" value={itemsOn} disabled={!isHost} onChange={(on) => setRoomItemsOn(roomId, on)}
                  options={[{ value: true, label: 'あり' }, { value: false, label: 'なし' }]} />
              </Field>
              {itemsOn && (
                <>
                  <CfgSlider label="お宝の出る確率" hint="出る内容は有利／不利で変わる（不利なら防御・逆転、有利なら攻撃が出やすい）"
                    value={num(meta.itemRate, 30)} display={`${num(meta.itemRate, 30)}%`} min={0} max={100} step={5}
                    disabled={!isHost} onChange={(v) => setRoomItemRate(roomId, v)} />
                  <Field label="出てくるアイテム" note={isHost ? '押すと出す／外すを切り替え（効果はオンラインのもの）' : 'ホストが決めます'}>
                    <div className="flex flex-col gap-4">
                      {CAT_META.map((c) => {
                        const list = (Object.keys(ITEM_CAT) as ItemType[]).filter((it) => ITEM_CAT[it] === c.key && !HIDDEN_ITEMS.has(it));
                        if (list.length === 0) return null;
                        return (
                          <div key={c.key}>
                            <div className="text-xs font-semibold text-muted mb-2">{c.label}</div>
                            <div className="grid gap-2 md:grid-cols-2">
                              {list.map((it) => {
                                const off = disabledItems.includes(it);
                                return (
                                  <button
                                    key={it}
                                    type="button"
                                    disabled={!isHost}
                                    aria-pressed={!off}
                                    onClick={() => setRoomDisabledItems(roomId, off ? disabledItems.filter((x) => x !== it) : [...disabledItems, it])}
                                    className="flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-left border transition-colors enabled:hover:border-[rgb(var(--n-50)/0.25)] disabled:cursor-default"
                                    style={{ borderColor: 'var(--line)', background: off ? 'transparent' : 'rgb(var(--n-50) / 0.035)', opacity: off ? 0.5 : 1 }}
                                  >
                                    <span className="text-lg leading-none mt-0.5 shrink-0">{ITEM_EMOJI[it]}</span>
                                    <span className="min-w-0 flex-1">
                                      <span className="flex items-center gap-1.5 flex-wrap">
                                        <span className={`text-sm font-semibold text-text ${off ? 'line-through' : ''}`}>{ITEM_META[it].name}</span>
                                        {BOSS_ONLY.has(it) && <span className="text-[11px] font-semibold px-1.5 rounded" style={{ color: 'var(--charge)', background: 'rgb(255 171 46 / 0.12)' }}>ボス戦</span>}
                                        {ONLINE_ONLY.has(it) && <span className="text-[11px] font-semibold px-1.5 rounded text-cyan-200" style={{ background: 'rgb(var(--ac-400) / 0.14)' }}>オンライン</span>}
                                      </span>
                                      <span className="block text-xs text-muted leading-snug mt-0.5">{ITEM_META[it].desc}</span>
                                    </span>
                                    <span className={`font-tech text-xs font-semibold shrink-0 mt-0.5 ${off ? 'text-muted' : 'text-cyan-300'}`}>{off ? 'OFF' : 'ON'}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Field>
                </>
              )}
            </CfgSection>

            <CfgSection title="アイテムの使い方（自分用）" icon={<Hand className="w-4 h-4" />}>
              <Field label="使い方" note={itemPrefs.autoFull ? '有利／不利を見て良いタイミングで自動発動（手動も可）' : undefined}>
                <Seg label="完全オート" value={itemPrefs.autoFull} onChange={(v) => updatePrefs({ ...itemPrefs, autoFull: v })}
                  options={[{ value: false, label: '種類ごとに決める' }, { value: true, label: '完全オート' }]} />
              </Field>
              {!itemPrefs.autoFull && (
                <div className="grid gap-2.5">
                  {CAT_META.map((c) => (
                    <div key={c.key} className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3">
                      <span className="text-sm font-semibold text-text">{c.label}</span>
                      <Seg label={`${c.label}の使い方`} value={itemPrefs.use[c.key]} onChange={(v) => updatePrefs({ ...itemPrefs, use: { ...itemPrefs.use, [c.key]: v } })}
                        options={USE_MODES.map((m) => ({ value: m.key, label: <span title={m.desc}>{m.label}</span> }))} />
                    </div>
                  ))}
                  <p className="text-xs text-muted leading-relaxed">
                    新着＝手動で発動 ／ 即時＝拾った瞬間 ／ オート＝良い時に自動 ／ 保持＝1つ持ち、重なったら新しい方を発動
                  </p>
                </div>
              )}
            </CfgSection>

            {isHost && (
              <CfgSection title="CPU を追加" icon={<Bot className="w-4 h-4" />}
                aside={cpuPlayers.length > 0 ? <span className="font-tech text-xs tabular-nums text-muted">{cpuPlayers.length}体</span> : undefined}>
                <p className="text-sm text-muted leading-relaxed -mt-1">人数が少ない時の相手に。CPU はホストの端末で動きます（バトルロワイヤル向け）。外す時は参加者一覧の × から。</p>
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] items-end">
                  <CfgSlider label="追加するCPUの強さ" hint="右は打つ速さの目安" value={cpuStr} display={`${cpuStr}（約${cpuKps(cpuStr / 10).toFixed(1)}打/秒）`} min={0} max={10} step={1} onChange={setCpuStr} />
                  <button
                    type="button"
                    onClick={() => addCpuPlayer(roomId, cpuStr / 10).catch(() => {})}
                    disabled={playerList.length >= meta.maxPlayers}
                    className="ui-btn-secondary h-10 px-4 text-sm disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" /> CPU を追加
                  </button>
                </div>
              </CfgSection>
            )}
          </Panel>
        </div>
      </main>

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
    </Shell>
  );
}
