import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

// デプロイ確認用のビルド識別子。反映されたか一目で分かるよう画面隅に薄く表示する。
// 変更をデプロイするたびに末尾を更新する（例: -a → -b）。
const BUILD = '2026-10-20-b';
console.info('[TYPE ROYALE] build', BUILD);

// 画面や辞書は後から読み込む（App.tsx）。公開を更新した直後に古いページを開いたままだと、
// 後読みするファイル名（中身ごとに変わる）が変わっていて読み込みに失敗する。
// その時はページを読み直して新しい版に切り替える（読み直しの繰り返しは30秒あけて防ぐ）。
window.addEventListener('vite:preloadError', (e) => {
  try {
    const KEY = 'typeRoyale.chunkReload';
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 30_000) return; // 直前に読み直したのにまた失敗＝通信の問題。案内に任せる
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { return; }
  e.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <div
      style={{
        position: 'fixed', right: 6, bottom: 4, zIndex: 9999,
        fontSize: 10, opacity: 0.35, pointerEvents: 'none',
        color: '#8aa', fontFamily: 'monospace', letterSpacing: '0.03em',
      }}
    >
      build {BUILD}
    </div>
  </React.StrictMode>,
);
