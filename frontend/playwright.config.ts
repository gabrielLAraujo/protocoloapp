import { defineConfig, devices } from '@playwright/test'

// The smoke test runs against a real API serving the built front (CI starts it; locally: dotnet run + `npm run build`, then
// copy dist to the API's wwwroot, or point E2E_BASE_URL at any running instance). Nothing here starts a server.
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5091',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
