# TYPE ROYALE（仮称 TypeRoyale）

テトリス99型の「つぶし合い」をタイピングで実現するオンライン対戦ゲーム。
速く正確に打つほど相手に「おじゃま単語」を送り込み、バックログ上限を超えた者から脱落、最後の1人が勝利する。

このリポジトリは **Phase 0（ソロ基盤）** のプロトタイプから始まります。お題表示・日本語ローマ字判定・連鎖・ベース供給＆加速・トップアウトまでをローカルで完結させた段階です。

> 詳細仕様は [`docs/spec-v0.2.md`](docs/spec-v0.2.md) を参照。

## 技術スタック

- [Vite](https://vitejs.dev/) + [React 18](https://react.dev/) + TypeScript
- [Tailwind CSS](https://tailwindcss.com/) v3（+ `tailwindcss-animate`）
- アイコン: [lucide-react](https://lucide.dev/)
- 将来のオンライン同期: Firebase Realtime Database（Phase 1 以降）
- ホスティング: GitHub Pages（GitHub Actions による自動デプロイ）

## 開発

```bash
npm install      # 依存インストール
npm run dev      # 開発サーバ起動（http://localhost:5173）
npm run build    # 型チェック + 本番ビルド（dist/）
npm run preview  # ビルド結果をローカルプレビュー
npm run lint     # 型チェックのみ
```

## 遊び方（Phase 0）

1. `SPACE` キーでゲーム開始。
2. 画面中央のお題（ひらがな）を **ローマ字** で打鍵。下段にローマ字ガイドが表示される。
3. 一定間隔でお題が自動供給され、間隔は時間経過で短くなる（加速）。
4. バックログ（処理待ちの山）が上限（12）を超えると **TOP OUT（脱落）**。
5. ゲームオーバー後は `SPACE` でリトライ。

ローマ字は複数の打ち方を許容（例: し＝`shi`/`si`、じゃ＝`ja`/`jya`/`zya`、促音っ＝次の子音を重ねる など）。

> 周囲のミニボード（ダミープレイヤー20人）は現状ダミー演出です。実際の対戦同期は Phase 1 以降で Firebase を用いて実装します。

## GitHub Pages デプロイ

`main` ブランチへの push で `.github/workflows/deploy.yml` が走り、`dist/` を GitHub Pages に公開します。
リポジトリの **Settings → Pages → Build and deployment → Source** を **「GitHub Actions」** に設定してください。
公開 URL: `https://<owner>.github.io/type_Battle/`

ビルド時の `base` パスは `/type_Battle/` に設定済み（`vite.config.ts`）。

## ロードマップ

| Phase | 内容 | 状態 |
|---|---|---|
| 0 | ソロ基盤（お題・判定・連鎖・供給加速・トップアウト） | ✅ プロトタイプ |
| 1 | オンライン接続（Firebase・ロビー・同期スタート・mini-board） | 未着手 |
| 2 | 攻撃送受信（おじゃま・予告ゲージ・相殺） | 未着手 |
| 3 | 戦略要素（ターゲティング4モード・バッジ/KO） | 未着手 |
| 4 | 決着まわり（脱落・順位・観戦・結果画面・切断処理） | 未着手 |
| 5 | 調整・演出・スケール検証 | 未着手 |
