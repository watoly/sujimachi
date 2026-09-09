import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// オフライン運用前提。base を相対にしておくと任意のパス配下で静的配信できる。
// WSL 上で動かした dev サーバーを Windows 側ブラウザから開けるよう host を有効化。
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: true,
    port: 5173,
  },
});
