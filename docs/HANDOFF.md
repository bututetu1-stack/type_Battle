# 引き継ぎ資料（2026-10-20 更新）

前のセッション（クラウド上の Claude Code）から、次のセッションへの引き継ぎ。
次のセッションは、まずこのファイルと `CLAUDE.md` を読んでから作業を始めること。

---

## 1. 利用者について

- 学生。オープンキャンパスでこのゲームを展示・実演した。これまで実装はほぼ AI に任せてきた。
- 日本語で、専門用語はかみ砕いて説明する。手順はコピペで済む形にすると喜ばれる。
- 作業PCは学校の Windows PC。プロジェクトは WSL 上の `/mnt/c/Users/kokik/type_battle`
  （Windows から見ると `C:\Users\kokik\type_battle`）。画面は一般的な比率（送られてくるスクショは部分的な切り抜きのことがある）。
- 「Gemini とも相談しながら進めたい」と言っている。Gemini の意見を貼ってもらったら反映する。

## 2. ここまでに終わっていること（すべて main に反映・公開済み）

| 内容 | 主なファイル |
|---|---|
| アイテム6種を削除（ロング送信/ブレーキ/ゲージ短縮/幸運/不死のトーテム/HPアップ） | `types.ts` `items.ts` 両ゲーム |
| ソロ出題の近接重複ガード（直近10語は再出させない）＋ `npm run wordtest` | `SoloGame.tsx` `scripts/wordbag-test.ts` |
| Vitest 導入、テスト 37 件（打鍵判定・アイテム定義・分析・記録） | `src/lib/*.test.ts` |
| アイテム定義をソロ/オンラインで一元化 | `items.ts` `ItemIcon.tsx` |
| テーマごとのアクセント色（`cyan-*` をアクセントの別名にして全画面連動） | `theme.ts` `tailwind.config.js` `index.css` |
| Firebase 未設定でも落ちない化＋ ErrorBoundary | `firebase.ts` `room.ts` `leaderboard.ts` `ErrorBoundary.tsx` |
| `npm run preview` の 404 修正 | `vite.config.ts` |
| ソロのリザルト分析（ランク・自己ベスト比較・速度推移グラフ・苦手キーのヒートマップ） | `analytics.ts` `ResultInsights.tsx` |
| デプロイ前にテストを実行 | `.github/workflows/deploy.yml` |

公開中のビルド識別子は `2026-10-20-a`（`src/main.tsx` の `BUILD`）。

## 3. 直近の依頼と対応状況

利用者の言葉（原文）:
> Tabで即リスタートとカウントダウンも追加して。
> 設定画面の上にバトル画面の上部が映っているのがすごく気になる。
> 設定画面の文字が小さく見づらいのでフォントサイズをもう少し大きく。
> デザインを大きく改善してほしい。今のままだと正直かなりダサくてちゃちい。

対応済み（作業ブランチ `claude/modest-tesla-qutos1` にコミット済み）:

- **はみ出し**: 原因は `<main>` の常時 `transform` で `fixed` の基準がずれていたこと。`createPortal` で解決。
- **Tab リスタート＋カウントダウン**: 利用者の選択で「Tab はどこでも即リスタート、狙いの切替は左Shiftへ」。
  保存済みの Tab 割り当ては自動移行。
- **デザイン**: 和文書体（IBM Plex Sans JP）、テーマに馴染む中間色、最小 12px、共通部品（`ui.tsx` / `ui-*`）。
  ソロ開始画面（2カラム・大きなスタート・自分の記録）、結果画面（共通化・全面・2カラム）、
  プレイ画面（計器バー・敵盤面を積み上げブロックに・ログ等を統一）、ホーム（主役/脇役の強弱）、
  記録画面（最後に遊んだモードで開く）、ライトテーマ（明暗反転で全画面対応）。
- 比較スクリーンショットは利用者に送付済み。**main への反映（公開）は利用者の確認待ち。**

まだ手を付けていない画面: オンラインのロビー／ルーム／対戦画面（`Lobby.tsx` `OnlineRoom.tsx`
`OnlineGame.tsx`）。中間色・アクセント・書体・敵盤面は共通なので自動で揃っているが、レイアウトと
小さなボタン群は旧来のまま。Firebase 設定の無い環境では対戦画面を実際に開けない点に注意。

### 未決の小さな事項

- CPU の名前の候補に「ブレーキ」が残っている（アイテムではなく名前）。紛らわしければ消す。
- リザルト分析はソロのみ。
- 前回提案して未着手: スマホ表示の対応、単語辞書（約270KB）の遅延読み込み。

## 4. 確認のしかた

- 見た目: `npm run build` → `npm run preview` → ブラウザで `http://localhost:4173/type_Battle/`。
- 前セッションでは Playwright（`playwright-core`）で自動操作し、ガイドに出る「次の1文字」を読んで
  打つボットで実プレイしてリザルトを撮影していた（ローマ字ガイドの次の文字は
  `.font-mono2 .text-primary.font-bold` で取れる）。
- テーマは `localStorage` の `typeRoyale.theme`、ソロの設定は `typeRoyale.custom`
  （例: `{"soloMode":"timeattack","taSeconds":15}`）で切り替えられる。
