// Firebase の設定値と「設定されているか」の判定だけを持つ軽いモジュール。
// SDK 本体（約340KB）を読み込まずに判定できるので、ホーム画面はこれだけを使い、
// SDK は表示の後で読み込む（firebase.ts）。
// 設定値はビルド時に環境変数（VITE_FIREBASE_*）から注入する。
//   - ローカル: リポジトリ直下の .env.local（Git 管理外）に記載
//   - 本番(GitHub Actions): リポジトリ Secrets から注入（.github/workflows/deploy.yml）
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// 設定（.env / Secrets）が無い環境でもアプリ全体が落ちないようにする。
// 未設定ならオンライン機能だけを止め、ソロは通常どおり動かす。
export const firebaseReady = Boolean(firebaseConfig.apiKey && firebaseConfig.databaseURL && firebaseConfig.projectId);
export const OFFLINE_MESSAGE = 'オンライン機能が設定されていません（Firebase の設定が必要です）。ソロは遊べます。';
