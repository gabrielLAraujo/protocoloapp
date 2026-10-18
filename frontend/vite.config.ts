import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// Local API (the "http" launch profile). The browser only talks to Vite, so dev behaves like production, where the API
// serves the front on the same origin.
const api = 'http://localhost:5190'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
