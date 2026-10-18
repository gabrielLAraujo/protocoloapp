import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { configDefaults, defineConfig } from 'vitest/config'

// Local API (the "http" launch profile). The browser only talks to Vite, so dev behaves like production, where the API
// serves the front on the same origin.
const api = 'http://localhost:5190'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable and offline: the whole app shell (including the sql.js WebAssembly) is precached. A new deploy waits for the
    // user's OK ("Nova versão disponível") instead of swapping files under an open session. Registered by src/pwa/serviceWorker.ts
    // (never in the Capacitor build), so no registerSW.js is injected. /api is never cached: sync has its own offline queue.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Protocolo',
        short_name: 'Protocolo',
        lang: 'pt-BR',
        description: 'Acompanhamento da consultoria de bodybuilding',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        // The dark page color (--page in index.css): the splash screen and the status bar tint.
        theme_color: '#0f1115',
        background_color: '#0f1115',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,webmanifest}'],
        // The sql.js binary is over Workbox's 2 MiB default.
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/health/, /^\/openapi/, /^\/scalar/],
      },
    }),
  ],
  server: {
    proxy: { '/api': api, '/openapi': api, '/scalar': api },
  },
  build: {
    rolldownOptions: {
      output: {
        // React in its own file: it rarely changes, so browsers keep it cached between deploys.
        codeSplitting: { groups: [{ name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }] },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // The Playwright specs under e2e/ run with `playwright test` against a real API, not in jsdom.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // An inherited NODE_ENV=production would load React's production build, which has no `act`.
    env: { NODE_ENV: 'test' },
  },
})
