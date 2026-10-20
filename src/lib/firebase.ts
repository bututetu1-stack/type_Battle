// Firebase 初期化と匿名認証。
// 設定値と firebaseReady は firebaseEnv.ts（SDK を読まずに判定できる軽いモジュール）にある。
// 注意: Web 版の apiKey は公開前提の識別子で秘密ではない。実際のアクセス制御は
//   Realtime Database セキュリティルール（database.rules.json）と
//   Google Cloud 側の API キー制限・承認済みドメインで担保する。
import { initializeApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';
import { getAuth, signInAnonymously, onAuthStateChanged, type Auth } from 'firebase/auth';
import { firebaseConfig, firebaseReady, OFFLINE_MESSAGE } from './firebaseEnv';

export { firebaseReady, OFFLINE_MESSAGE } from './firebaseEnv';

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
