import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages（https://<user>.github.io/type_Battle/）配信のため base を設定。
// ローカル開発時は '/' を使う。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/type_Battle/' : '/',
  plugins: [react()],
}));
