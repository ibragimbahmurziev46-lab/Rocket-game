import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// ВАЖНО: имя репозитория точно как в адресе GitHub
// github.com/твой-логин/rocket-lab  →  'rocket-lab'
const REPO = 'rocket-lab';

export default defineConfig(({ mode }) => {
  const isElectron = mode === 'electron';
  // GitHub Actions подставляет имя репозитория сам, локально берём REPO
  const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? REPO;
  const base = isElectron ? './' : mode === 'pages' ? `/${repoName}/` : '/';

  return {
    base,
    plugins: [
      react(),
      !isElectron &&
        VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['icon.svg'],
          // в dev-режиме service worker выключен — проверяем через build + preview
          devOptions: { enabled: false },
          workbox: {
            globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
            navigateFallback: `${base}index.html`,
            cleanupOutdatedCaches: true,
          },
          manifest: {
            name: 'Rocket Lab',
            short_name: 'RocketLab',
            description: 'Симулятор ракет: погоня за курсором и режим стройки',
            lang: 'ru',
            theme_color: '#0b1026',
            background_color: '#0b1026',
            display: 'standalone',
            orientation: 'any',
            start_url: base,
            scope: base,
            icons: [
              { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
              { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
              {
                src: 'pwa-512-maskable.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable',
              },
            ],
          },
        }),
    ],
    build: { outDir: 'dist', assetsDir: 'assets' },
  };
});