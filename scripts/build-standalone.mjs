/**
 * 配布用の単一 HTML をビルドする。
 *
 * Node も Python も静的サーバーも用意できない環境があるため、JS/CSS をすべて 1 枚の HTML にインライン化し、
 * file:// でダブルクリックするだけで動く成果物を作る。
 *
 * ES モジュールは file:// から読み込めない（CORS）ので、出力形式を iife にして
 * 「ただのクラシックスクリプト」にしているのが要点。
 *
 *   node scripts/build-standalone.mjs   →  dist-standalone/sujimachi.html
 */
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = path.join(root, 'dist-standalone', '.raw');
const outFile = path.join(root, 'dist-standalone', 'sujimachi.html');

await rm(path.join(root, 'dist-standalone'), { recursive: true, force: true });

await build({
  root,
  configFile: false,
  plugins: [react()],
  base: './',
  logLevel: 'warn',
  build: {
    outDir: rawDir,
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    // 画像等の資産も base64 で埋め込む（現状は資産なしだが将来のため）
    assetsInlineLimit: 100 * 1024 * 1024,
    rollupOptions: {
      output: {
        // file:// で動かすため module ではなく iife にする
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
});

let html = await readFile(path.join(rawDir, 'index.html'), 'utf8');
const js = await readFile(path.join(rawDir, 'app.js'), 'utf8');
let css = '';
try {
  css = await readFile(path.join(rawDir, 'app.css'), 'utf8');
} catch {
  // CSS が出力されない構成でも壊さない
}

/** インライン化したスクリプトが </script> で早期終了しないようにする。 */
const safeJs = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

// 置換値は必ず関数で渡す。文字列を渡すと $& や $` が置換パターンとして
// 解釈され、バンドル中の $ 記号によって元のタグが復活してしまう。

// head にある <script src="./app.js"> を取り除く。
// 元は type="module"（自動 defer）だが、インライン化するとクラシックスクリプトに
// なり head 内で即時実行される＝ #root がまだ無い。そのため body 末尾へ移す。
const scriptTagRe = /<script\b[^>]*\bsrc=["']\.?\/?app\.js["'][^>]*><\/script>\s*/i;
if (!scriptTagRe.test(html)) {
  throw new Error('app.js の script タグが見つかりません（出力形式を確認してください）');
}
html = html.replace(scriptTagRe, () => '');

// <link rel="stylesheet" href="./app.css"> をインライン化（CSS は head のままでよい）
html = html.replace(
  /<link\b[^>]*\bhref=["']\.?\/?app\.css["'][^>]*>/i,
  () => (css ? `<style>\n${css}\n</style>` : ''),
);

// #root が生成されたあとに実行されるよう body 末尾へ差し込む
if (!html.includes('</body>')) {
  throw new Error('</body> が見つかりません');
}
html = html.replace('</body>', () => `  <script>\n${safeJs}\n  </script>\n  </body>`);

if (html.includes('app.js')) {
  throw new Error('app.js のインライン化に失敗しました（index.html の参照形式を確認してください）');
}
if (css && html.includes('app.css')) {
  throw new Error('app.css のインライン化に失敗しました');
}

html = html.replace(
  '<head>',
  () => `<head>\n    <!-- sujimachi 配布版（単一 HTML）: サーバー不要。ブラウザで直接開けます。 -->`,
);

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, html, 'utf8');
await rm(rawDir, { recursive: true, force: true });

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
console.log(`built: ${path.relative(root, outFile)} (${kb} KB)`);
