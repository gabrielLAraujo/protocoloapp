import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { configDefaults, defineConfig } from 'vitest/config'
import { jeepSqliteAtomicSave } from './build/jeepSqliteAtomicSave.ts'

// Local API (the "http" launch profile). The browser only talks to Vite, so dev behaves like production, where the API
// serves the front on the same origin.
const api = 'http://localhost:5190'

export default defineConfig({
  plugins: [
    // Before the bundler sees jeep-sqlite: its web save must not delete the stored database first (see the file).
    { ...jeepSqliteAtomicSave(), enforce: 'pre' },
    react(),
    tailwindcss(),
    // Installable and offline: the whole app shell (including the sql.js WebAssembly) is precached. A new deploy waits for the
    // user's OK ("Nova versão disponível") instead of swapping files under an open session. Registered by src/pwa/serviceWorker.ts
    // (never in the Capacitor build), so no registerSW.js is injected. /api is never cached: sync has its own offline queue.
    // Our own worker (src/sw.ts, injectManifest) so it can show the Web Push reminders; it keeps the navigation fallback (and its
    // denylist, in src/pwa/swHandlers.ts) and answers the SKIP_WAITING message of the "Atualizar" button.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
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
        theme_color: '#f6f7f9',
        background_color: '#f6f7f9',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,webmanifest,woff2}'],
        // Workbox's default is 2 MiB; the sql.js binary is about 0.6 MiB, so 3 MiB covers it and still flags a surprise big file.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
  // Dev pre-bundles dependencies without the plugins above: same fix there.
  optimizeDeps: { rolldownOptions: { plugins: [jeepSqliteAtomicSave()] } },
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
