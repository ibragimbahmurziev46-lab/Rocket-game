/* Генератор иконок: SVG зашит внутри, внешние файлы не нужны.
   Запуск: npm run icons  (или node scripts/make-icons.mjs) */
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let sharp;
let pngToIco;
try {
  sharp = (await import('sharp')).default;
  pngToIco = (await import('png-to-ico')).default;
} catch {
  console.error('Не установлены зависимости. Выполни: npm i -D sharp png-to-ico');
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const BUILD = join(ROOT, 'build');

const BG = '#0b1026';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a1030"/>
      <stop offset="1" stop-color="#05070f"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.3" cy="0.25" r="0.85">
      <stop offset="0" stop-color="#1d4ed8" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#7c3aed" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="0.8" cy="0.8" r="0.7">
      <stop offset="0" stop-color="#38bdf8" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#a78bfa" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.55" stop-color="#e6ebf0"/>
      <stop offset="1" stop-color="#90a4ae"/>
    </linearGradient>
    <linearGradient id="nose" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff6b6b"/>
      <stop offset="1" stop-color="#b71c1c"/>
    </linearGradient>
    <linearGradient id="flame" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0" stop-color="#fff3c4"/>
      <stop offset="0.45" stop-color="#ffb347"/>
      <stop offset="1" stop-color="#ff5722" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <rect width="512" height="512" rx="112" fill="url(#glow)"/>
  <rect width="512" height="512" rx="112" fill="url(#glow2)"/>

  <g fill="#9bd7ff">
    <circle cx="96" cy="120" r="4" opacity="0.85"/>
    <circle cx="420" cy="96" r="3" opacity="0.6"/>
    <circle cx="380" cy="420" r="5" opacity="0.7"/>
    <circle cx="120" cy="400" r="3" opacity="0.5"/>
    <circle cx="450" cy="250" r="3" opacity="0.55"/>
    <circle cx="250" cy="70" r="2.5" opacity="0.45"/>
    <circle cx="70" cy="270" r="2.5" opacity="0.4"/>
  </g>

  <g transform="translate(256 256) scale(6)">
    <!-- сопло -->
    <path d="M-5 24 L-7 29 L7 29 L5 24 Z" fill="#2b2e1c"/>
    <!-- боковые плавники -->
    <path d="M-7.5 11 L-7.5 26 L-16 26 L-7.5 17 Z" fill="#6f7448"/>
    <path d="M7.5 11 L7.5 26 L16 26 L7.5 17 Z" fill="#6f7448"/>
    <!-- корпус с оживальным носом -->
    <path d="M0 -32 C-1.6 -24 -5 -16 -8.5 -9 L-8.5 24 L8.5 24 L8.5 -9 C5 -16 1.6 -24 0 -32 Z" fill="#6f7448"/>
    <!-- кольцо-стык -->
    <line x1="-8.5" y1="-9" x2="8.5" y2="-9" stroke="#2b2e1c" stroke-width="1.2"/>
  </g>
</svg>
`;

const src = Buffer.from(SVG, 'utf8');
const made = [];

async function png(size, file, dir) {
  const target = join(dir, file);
  await sharp(src, { density: 384 }).resize(size, size).png().toFile(target);
  made.push(target);
}

try {
  mkdirSync(PUBLIC, { recursive: true });
  mkdirSync(BUILD, { recursive: true });

  writeFileSync(join(PUBLIC, 'icon.svg'), SVG, 'utf8');
  made.push(join(PUBLIC, 'icon.svg'));

  await png(192, 'pwa-192.png', PUBLIC);
  await png(512, 'pwa-512.png', PUBLIC);
  await png(180, 'apple-touch-icon.png', PUBLIC);
  await png(32, 'favicon-32.png', PUBLIC);
  await png(16, 'favicon-16.png', PUBLIC);

  // maskable: контент внутри безопасной зоны 80%
  const inner = await sharp(src, { density: 384 }).resize(400, 400).png().toBuffer();
  const maskable = join(PUBLIC, 'pwa-512-maskable.png');
  await sharp({ create: { width: 512, height: 512, channels: 4, background: BG } })
    .composite([{ input: inner }])
    .png()
    .toFile(maskable);
  made.push(maskable);

  // Electron / Windows
  await png(256, 'icon.png', BUILD);
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const buffers = [];
  for (const size of icoSizes) {
    buffers.push(await sharp(src, { density: 384 }).resize(size, size).png().toBuffer());
  }
  const icoPath = join(BUILD, 'icon.ico');
  writeFileSync(icoPath, await pngToIco(buffers));
  made.push(icoPath);

  console.log('\nИконки готовы:\n');
  for (const file of made) {
    const kb = (statSync(file).size / 1024).toFixed(1);
    console.log(`  ${file.replace(ROOT + '\\', '').replace(ROOT + '/', '')}  —  ${kb} КБ`);
  }
  console.log('\nДальше: npm run build && npm run preview — появится кнопка «Установить».\n');
} catch (err) {
  console.error('Ошибка генерации иконок:', err.message);
  process.exit(1);
}