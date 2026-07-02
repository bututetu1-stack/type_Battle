import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// デプロイ確認用のビルド識別子。反映されたか一目で分かるよう画面隅に薄く表示する。
// 変更をデプロイするたびに末尾を更新する（例: -a → -b）。
const BUILD = '2026-07-02-a';
console.info('[TYPE ROYALE] build', BUILD);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
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
