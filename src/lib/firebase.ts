// Firebase 初期化と匿名認証。
// 設定値はビルド時に環境変数（VITE_FIREBASE_*）から注入する。
//   - ローカル: リポジトリ直下の .env（Git 管理外）に記載
//   - 本番(GitHub Actions): リポジトリ Secrets から注入（.github/workflows/deploy.yml）
// 注意: Web 版の apiKey は公開前提の識別子で秘密ではない。実際のアクセス制御は
//   Realtime Database セキュリティルール（database.rules.json）と
//   Google Cloud 側の API キー制限・承認済みドメインで担保する。
import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const db = getDatabase(app);
export const auth = getAuth(app);

// 匿名サインインして uid を返す。既にサインイン済みならその uid。
export function ensureSignedIn(): Promise<string> {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        unsub();
        resolve(user.uid);
      }
    });
    signInAnonymously(auth).catch((err) => {
      unsub();
      reject(err);
    });
  });
}
