// Firebase 初期化と匿名認証。
// apiKey 等は Web クライアントに埋め込む前提の公開値（秘密ではない）。
// アクセス制御は Realtime Database セキュリティルール（database.rules.json）で行う。
import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyBRBR2slKi9R1WJ4IoR_z_UxqJcsl58hLc',
  authDomain: 'type-283c2.firebaseapp.com',
  databaseURL: 'https://type-283c2-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'type-283c2',
  storageBucket: 'type-283c2.firebasestorage.app',
  messagingSenderId: '373041716679',
  appId: '1:373041716679:web:c41d2b9d6a5dd58d578de2',
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
