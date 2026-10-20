// Firebase 初期化と匿名認証。
// 設定値はビルド時に環境変数（VITE_FIREBASE_*）から注入する。
//   - ローカル: リポジトリ直下の .env（Git 管理外）に記載
//   - 本番(GitHub Actions): リポジトリ Secrets から注入（.github/workflows/deploy.yml）
// 注意: Web 版の apiKey は公開前提の識別子で秘密ではない。実際のアクセス制御は
//   Realtime Database セキュリティルール（database.rules.json）と
//   Google Cloud 側の API キー制限・承認済みドメインで担保する。
import { initializeApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';
import { getAuth, signInAnonymously, onAuthStateChanged, type Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// 設定（.env / Secrets）が無い環境でもアプリ全体が落ちないようにする。
// 以前は未設定だと読み込み時に getDatabase が例外を投げ、ソロすら遊べない真っ白画面になっていた。
// 未設定ならオンライン機能だけを止め、ソロは通常どおり動かす。
export const firebaseReady = Boolean(firebaseConfig.apiKey && firebaseConfig.databaseURL && firebaseConfig.projectId);
export const OFFLINE_MESSAGE = 'オンライン機能が設定されていません（Firebase の設定が必要です）。ソロは遊べます。';

const app = firebaseReady ? initializeApp(firebaseConfig) : null;
let db: Database | null = null;
let auth: Auth | null = null;

// オンライン機能から呼ぶ。未設定なら分かりやすいメッセージで失敗させる。
export function getDb(): Database {
  if (!app) throw new Error(OFFLINE_MESSAGE);
  return (db ??= getDatabase(app));
}
function getAuthInstance(): Auth {
  if (!app) throw new Error(OFFLINE_MESSAGE);
  return (auth ??= getAuth(app));
}

// 匿名サインインして uid を返す。既にサインイン済みならその uid。
export function ensureSignedIn(): Promise<string> {
  if (!app) return Promise.reject(new Error(OFFLINE_MESSAGE));
  const a = getAuthInstance();
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(a, (user) => {
      if (user) {
        unsub();
        resolve(user.uid);
      }
    });
    signInAnonymously(a).catch((err) => {
      unsub();
      reject(err);
    });
  });
}
