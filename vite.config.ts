import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages（https://<user>.github.io/type_Battle/）配信のため base を設定。
// ローカル開発時は '/' を使う。preview はビルド成果物を配信するので本番と同じ base にする。
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/type_Battle/' : '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // ベンダーを分割して初期ロードとキャッシュ効率を改善（単一800KB chunk警告の解消）。
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-firebase': ['firebase/app', 'firebase/database', 'firebase/auth'],
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
}));
