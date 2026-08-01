/* Builds the single self-contained artifact: dist/index.html
   Run: node build.mjs */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(root, f), 'utf8');

// concatenation order matters: data → sim → renderers → audio → ui → main
const JS_FILES = [
  'src/data.js',
  'src/sim.js',
  'src/gfx.js',
  'src/art.js',
  'src/render_site.js',
  'src/render_factory.js',
  'src/render_fp.js',
  'src/audio.js',
  'src/ui.js',
  'src/main.js',
];

const css = read('src/style.css');
const js = JS_FILES.map(f => `/* ==== ${f} ==== */\n` + read(f)).join('\n');

let html = read('src/shell.html');
html = html.replace('/*__CSS__*/', () => css);
html = html.replace('/*__JS__*/', () => js);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/index.html'), html);
console.log(`built dist/index.html (${(html.length / 1024).toFixed(0)} KB)`);
