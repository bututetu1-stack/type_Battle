# TYPE ROYALE — 開発メモ（Claude Code 向け）

テトリス99型の「つぶし合い」をタイピングでやる日本語オンライン対戦ゲーム。
React 18 + TypeScript + Vite + Tailwind 3、オンラインは Firebase Realtime Database（匿名認証）。

**作業を始める前に `docs/HANDOFF.md` を読むこと**（進行中のタスクと経緯がある）。

## コマンド

```bash
npm install        # 依存を入れる（package.json が変わったら再実行）
npm run dev        # 開発サーバ http://localhost:5173/
npm test           # Vitest（打鍵判定・アイテム定義・分析・記録）。コミット前に必ず
npm run build      # tsc -b（型チェック）+ 本番ビルド。コミット前に必ず
npm run preview    # ビルド結果を http://localhost:4173/type_Battle/ で確認
npm run wordtest   # 出題の近接重複を数値で確認
npm run balancesim # ソロの難易度バランス（打鍵の速さ別の勝率・試合時間）を模擬対戦で確認
node scripts/screenshots.mjs [出力先] [テーマ] [幅x高さ]  # 自動プレイしてスクショ（準備は docs/HANDOFF.md 5章）
```

## 公開（デプロイ）

- `main` への push で GitHub Actions（`.github/workflows/deploy.yml`）が
  `npm ci → npm test → npm run build` を実行し、`gh-pages` ブランチへ公開する。
  テストが落ちたら公開されない。
- 公開URL: https://bututetu1-stack.github.io/type_Battle/
- 反映確認用に `src/main.tsx` の `BUILD` 定数を公開のたびに更新する（画面右下に出る）。
- 作業ブランチで作って検証し、まとめて `main` へ反映する。`main` への push は公開になるので、
  利用者の了承を取ってから。

## ハマりどころ

- **Firebase 設定（`.env.local`）が無くてもソロは動く。** `src/lib/firebase.ts` は設定が揃った時だけ
  初期化し、DB は `getDb()` で取る。未設定ならオンラインだけ案内を出して止まる。
  設定の有無（`firebaseReady`）は SDK を読まない `src/lib/firebaseEnv.ts` で判定する。
- **初回表示を軽く保つ。** `App.tsx`（ホーム）から単語辞書 `words.ts`・Firebase（`firebase.ts` / `room.ts` /
  `leaderboard.ts`）・ゲーム画面を**静的に import しない**。各画面は `lazy()` で、ホーム表示後に空き時間で先読みする。
  ローマ字表・判定・ルビなど軽い部分は `romaji.ts`（`words.ts` からも再公開）。
  確認: `npm run build` で `dist/index.html` の modulepreload に `vendor-firebase` や `words` が出ないこと。
  本物の値は GitHub Secrets にある。ローカルは `.env.example` を写してダミー値でもよい。
- **オンラインを手元で試す時は `.env.online.local` に設定を書き、`npm run dev -- --mode online` で起動する。**
  `.env.local` に書くとソロの確認（タイムアタック）でも本物のオンラインランキングに記録が送られてしまう。
  Web 用の設定値は公開中のビルド（gh-pages の JS）にも入っている公開値。
  2人で試すには別のブラウザ（または別プロファイル／シークレット）でもう1人入る。
- `tsconfig` は `noUnusedLocals` / `noUnusedParameters` が有効。使わなくなった import は消す。
- 型チェックが不自然に通る／落ちる時は `tsconfig*.tsbuildinfo`（増分キャッシュ、git 管理外）を消す。
- `vite.config.js` は `vite.config.ts` のコンパイル結果（git 管理外）。編集するのは `.ts`。
- オンラインは**全員が共通シードから同じお題列を生成**して同期している。`generateWord` の
  乱数の消費順を変えるとズレる。ソロ専用の工夫（直近重複ガード等）は SoloGame 側でやる。

## 構成の要点

- `src/components/SoloGame.tsx`（約2500行）/ `OnlineGame.tsx`（約2000行）がゲーム本体。
  効果の分岐（アイテムを使った時の処理）はモードごとに違うので各ファイルにある。
- アイテムの名前・アイコン・説明・効果時間は **`src/lib/items.ts` が唯一の定義**
  （`ITEM_META` / `ONLINE_ITEM_META` / `ITEM_DURATION`）。アイコンは `components/ItemIcon.tsx`。
  アイテムを足す・消す時は `types.ts` の `ItemType`、`items.ts`、両ゲームの効果分岐とドロップ候補
  （Solo の `ALL_ITEMS`、Online の `grantItem` 内の配列）を直す。
- 打鍵判定は `src/lib/engine.ts`（純粋関数）、ローマ字表・ルビは `src/lib/romaji.ts`、
  出題は `src/lib/words.ts`（約4400行の辞書込み）。
- リザルトの分析（ランク・速度推移・苦手キー）は `src/lib/analytics.ts`（純粋関数）と
  `components/ResultInsights.tsx`。
- ソロの難易度プリセットは `src/lib/difficulty.ts`、敵CPUの動きは `src/lib/cpu.ts`（どちらも純粋）。
  CPU は「打つ速さ」を持つプレイヤーとして、自分と同じペースで積まれる単語を片付ける（遅い順に脱落）。
  数値を変えたら `npm run balancesim`（`scripts/balance-sim.ts`）で勝率・試合時間を確かめる。
  模擬対戦は SoloGame の攻撃・相殺・アイテムの数値を写しているので、そちらを変えたら合わせる。

## デザインの仕組み

- 色は CSS 変数のトークン（`src/index.css` の `:root`）。テーマ切替は `src/lib/theme.ts` が
  `body` に変数を流し込む。Tailwind では `bg-surface` `text-muted` `border-line` `text-primary` など。
- アクセント色は `--ac-50`〜`--ac-950`（RGB 三つ組）。**Tailwind の `cyan-*` はアクセントの別名**に
  してあるので、`text-cyan-300` はテーマのアクセント色で表示される（`tailwind.config.js`）。
- **中間色も同じ仕組み。** `gray-*` / `neutral-*` は `--n-50`〜`--n-950` の別名で、テーマの背景色の色味を
  少し帯びる。**ライトテーマでは中間色・アクセントとも濃淡を明暗反転**して流し込む（`950`＝背景用が白寄り、
  `300`＝文字用が濃い色になる）。新しい部品は「`n-950` 系を背景、`n-50` 系を文字」に使えばどのテーマでも読める。
  アクセントの塗りの上の文字は `text-white` ではなく `text-bg`（`var(--bg)`）を使う。
- 書体は IBM Plex Sans JP（本文・和文。`palt` 有効）、Chakra Petch（見出し・数字 `font-tech`）、
  JetBrains Mono（ローマ字 `font-mono2`）を Google Fonts から読み込み。
- 共通部品: `src/components/ui.tsx`（`Seg` セグメント / `Field` / `Panel` / `Kbd` キー表示 / `IconBtn` /
  `Hud` ヘッダーの計器 / `CfgSlider` 設定スライダー / `CfgSection` 折りたたみ。`disabled` で見せるだけにもできる）と
  `src/index.css` の `ui-*` クラス（`ui-panel` `ui-seg` `ui-chip` `ui-kbd` `ui-btn-primary` `ui-btn-secondary`
  `ui-eyebrow`）。新しい画面はこれを使い、色付きの小ボタンや絵文字の見出しを増やさない。
- 文字は最小 12px、本文 14px、見出し 15〜17px。意味の色（被弾=incoming / お宝=charge / 通常=backload）は
  面を塗らず、左端の細い帯やアイコンに使う。
- 利用者の画面は一般的な比率。1920×1080（モニター）と 1366×768（ノートPC）で崩れないことを確認する。

## 操作の決まり

- **Tab はソロのリスタート専用**（`keyconfig.ts` の `RESTART_CODE`）。他の操作には割り当てられない。
  狙いの切替の既定は左Shift。オンライン対戦中の Tab は無効。
- ソロの開始は `setupGame`（盤面準備・`GameStatus='countdown'`）→ 3・2・1・GO → 本番（`'playing'`）。
  計測（KPS・制限時間・速度推移）は GO の瞬間から。
- 開始/設定オーバーレイと結果画面は `createPortal` で body 直下に出している（`<main>` は画面揺れ演出の
  `transform` を持つので、中に置くと `fixed` の基準がずれる）。

## 進め方

- 機能ごとにコミットし、毎回 `npm test` と `npm run build` を通してから。
- 見た目の変更は実際に画面を開いて（スクリーンショットで）確認してから完了とする。
