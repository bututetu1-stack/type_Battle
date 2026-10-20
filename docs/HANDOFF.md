# 引き継ぎ資料（2026-10-20 時点・利用者のPCへ移行）

クラウド上の Claude Code セッションから、**利用者のPCで動く Claude Code** への引き継ぎ。
次のセッションは、まずこのファイルと `CLAUDE.md`（コマンド・仕組み・ハマりどころ）を読んでから作業すること。

---

## 0. 再開の手順（利用者が行う）

### 0-1. コードを用意する（WSL のターミナルで）

まだこのPCに無い場合:

```bash
cd /mnt/c/Users/kokik
git clone -b claude/modest-tesla-qutos1 https://github.com/bututetu1-stack/type_battle.git
cd type_battle
```

すでにある場合（学校PCの `/mnt/c/Users/kokik/type_battle` など）:

```bash
cd /mnt/c/Users/kokik/type_battle
git fetch origin
git checkout claude/modest-tesla-qutos1
git pull
```

続けて（どちらの場合も）:

```bash
npm install
npm test          # 40件すべて通ればOK
npm run dev       # http://localhost:5173/ でゲームが開く
```

- `.env.local` が無くても**ソロは遊べる**（オンライン対戦だけ「未設定」と出る）。
- オンライン対戦も手元で試すなら `.env.example` を `.env.local` に写し、Firebase の値を入れる。
  本物の値は GitHub Secrets に入っているが、**Secrets は後から読み出せない**ので、
  Firebase コンソール →「プロジェクトの設定」→「マイアプリ」の構成（`firebaseConfig`）から写す。

### 0-2. Claude Code をこのPCで起動する

どちらか一つ。

- **ターミナル（おすすめ）**: WSL のプロジェクトのフォルダで
  ```bash
  npm install -g @anthropic-ai/claude-code   # 初回だけ
  claude
  ```
  Node.js は WSL 側に入っているので、WSL のターミナルから使うのが一番つまずかない。
  （`claude remote-control` で起動すると、Claude のアプリからこのセッションを操作できる）
- **Claude デスクトップアプリ**: Code の画面でフォルダ `C:\Users\kokik\type_battle` を選ぶ。
  アプリ内のブラウザ（Ctrl+Shift+B）で Claude が `localhost:5173` を直接開いて確認できる。
  ただし Windows 側に Node.js が無いと `npm` が動かないので、その時は Node.js（LTS）を Windows にも入れる。

最初のメッセージの例:
> `docs/HANDOFF.md` を読んで、4章の「次の候補」から続けて。

> 学校のPCなら、アプリや拡張機能を入れてよいか学校のルールを確認すること。共用PCなら使い終わったらサインアウト。

---

## 1. 利用者について

- 学生。オープンキャンパスでこのゲームを展示・実演した。これまで実装はほぼ AI に任せてきた。
- 日本語で、専門用語はかみ砕いて説明する。手順はコピペで済む形にすると喜ばれる。
- 作業PCは Windows ＋ WSL。プロジェクトは `/mnt/c/Users/kokik/type_battle`
  （Windows から見ると `C:\Users\kokik\type_battle`）。画面は一般的な比率
  （送られてくるスクショは部分的な切り抜きのことがある）。
- 「Gemini とも相談しながら進めたい」と言っている。Gemini の意見を貼ってもらったら反映する。
- デザインについて「ダサくてちゃちい」と率直に言うので、見た目は必ずスクショで見せて確認を取る。

## 2. 現在の状態

- **すべて公開済み。** `main` と作業ブランチ `claude/modest-tesla-qutos1` は同じ位置（ドキュメントの更新を除く）。
- 公開URL: https://bututetu1-stack.github.io/type_Battle/ 　ビルド識別子 `2026-10-20-b`（画面右下）。
- `main` への push で自動デプロイ（テスト → ビルド → gh-pages）。**push は公開になるので利用者の了承を取ってから。**

## 3. これまでにやったこと

| 内容 | 主なファイル |
|---|---|
| アイテム6種を削除（ロング送信/ブレーキ/ゲージ短縮/幸運/不死のトーテム/HPアップ） | `types.ts` `items.ts` 両ゲーム |
| ソロ出題の近接重複ガード（直近10語は再出させない）＋ `npm run wordtest` | `SoloGame.tsx` `scripts/wordbag-test.ts` |
| Vitest 導入（打鍵判定・アイテム定義・分析・記録・キー設定の移行。計40件） | `src/lib/*.test.ts` |
| アイテム定義をソロ/オンラインで一元化 | `items.ts` `ItemIcon.tsx` |
| テーマごとのアクセント色、テーマに馴染む中間色、ライトテーマの明暗反転 | `theme.ts` `tailwind.config.js` `index.css` |
| Firebase 未設定でも落ちない化＋ ErrorBoundary | `firebase.ts` `room.ts` `leaderboard.ts` `ErrorBoundary.tsx` |
| ソロのリザルト分析（ランク・自己ベスト比較・速度推移・苦手キーのヒートマップ） | `analytics.ts` `ResultInsights.tsx` |
| Tab で即リスタート（狙いの切替は左Shiftへ自動移行）＋開始前の 3・2・1・GO | `SoloGame.tsx` `keyconfig.ts` |
| ソロ開始画面の上にバトル画面がはみ出す不具合（`transform` の影響）を修正 | `SoloGame.tsx` |
| デザインの作り直し: 和文書体、最小12px、共通部品、開始画面・結果画面・プレイ画面・ホーム・敵の盤面 | `ui.tsx` `index.css` `SoloGame.tsx` `App.tsx` `MiniBoard.tsx` |
| 記録画面は最後に遊んだモードのタブで開く | `RecordsBoard.tsx` |
| 見た目確認用の自動プレイ＋スクショ | `scripts/screenshots.mjs` |

## 4. 次の候補（利用者とまだ合意していないもの）

1. **オンラインのロビー／ルーム／対戦画面のデザイン**（`Lobby.tsx` `OnlineRoom.tsx` `OnlineGame.tsx`）。
   色・書体・敵の盤面は共通なので揃っているが、配置と小さな色付きボタン群は旧来のまま。
   ソロで作った部品（`ui.tsx` / `ui-*` クラス）と、ソロの結果画面・開始画面の作りに合わせるとよい。
   **Firebase の設定が無いと対戦画面は開けない**ので、`.env.local` を用意してから。
2. リザルト分析をオンラインの結果画面にも出す。
3. CPU の名前の候補に「ブレーキ」が残っている（アイテムではなく名前）。紛らわしければ消す。
4. スマホ表示の対応（ホーム・記録・結果だけでも）。ゲーム画面は「物理キーボードが必要」と案内する。
5. 単語辞書（`words.ts` 約270KB）の遅延読み込みで初回表示を速くする。

## 5. 確認のしかた

- 型と動作: `npm test` と `npm run build`（コミット前に必ず）。
- 見た目: 自動プレイしてスクショを撮る。
  ```bash
  npm i --no-save playwright && npx playwright install chromium   # 初回だけ（package.json は変えない）
  npm run build && npm run preview     # 別のターミナル
  node scripts/screenshots.mjs shots violet 1920x1080
  node scripts/screenshots.mjs shots light 1366x768
  ```
  ホーム・ソロ開始・プレイ中・結果（タイムアタック）の4枚が `shots/` に出る（git 管理外）。
  ボットはローマ字ガイドの「次の1文字」（`.font-mono2 .text-primary.font-bold`）を読んで打ち、時々わざとミスする。
- デスクトップアプリで作業している場合は、アプリ内のブラウザで `localhost:5173` を直接開いて見てもよい。
- テーマは `localStorage` の `typeRoyale.theme`、ソロの設定は `typeRoyale.custom`
  （例: `{"soloMode":"timeattack","taSeconds":15}`）、キー設定は `typeRoyale.keys` で切り替えられる。
- 確認する画面サイズ: 1920×1080 と 1366×768。テーマはダーク系1つとライトの両方。
