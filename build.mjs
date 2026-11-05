// Bundles the app into ONE self-contained file: dist/paisa.html (works offline, from a file:// URL or any static host).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const result = await build({
  entryPoints: ['js/main.js'], bundle: true, format: 'iife', minify: true, target: ['es2020'], write: false, legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync('css/styles.css', 'utf8');
const chart = readFileSync('vendor/chart.umd.min.js', 'utf8').replace(/<\/script/gi, '<\\/script');
let html = readFileSync('index.html', 'utf8');
html = html
  .replace('<link rel="stylesheet" href="css/styles.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script src="vendor/chart.umd.min.js"></script>', () => `<script>${chart}</script>`)
  .replace('<script type="module" src="js/main.js"></script>', () => `<script>${js}</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/paisa.html', html);
console.log(`dist/paisa.html  ${(html.length / 1024).toFixed(0)} KB`);
