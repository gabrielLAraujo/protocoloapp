import { expect, test, type Page, type Response } from '@playwright/test'
import { login } from './support/auth.ts'

// Runs after the `chromium` project (playwright.config.ts, project `today`): workout.spec.ts activated the fictitious sheet
// today (day A, "Treino A - Exemplo", is today's) and logged an app session for it. CI points the API at the Hevy stand-in
// (e2e/fixtures/hevy-stub.mjs, Hevy__BaseUrl) with a test-only Integrations__EncryptionKey and the scheduler off
// (Hevy__Enabled=false), so only "Sincronizar agora" reaches it. The stub serves one fictitious workout dated today, titled
// like day A, with one exercise of the sheet and one new. Assumes the fresh database CI starts per run.
const KEY = 'test-key-0000-0000-0000-000000000001'
const DAY = 'Treino A - Exemplo'

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name, exact: true })

const isHevy = (method: string, path = '') => (r: Response) =>
  r.request().method() === method && new URL(r.url()).pathname === `/api/integrations/hevy${path}`

/** Waits for the header to say "Sincronizado" with nothing pending (the label only shows after a complete, successful run). */
async function expectSynced(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Sincronizado$/ })).toBeVisible()
  await expect(page.locator('header').getByText(/pendente/)).toHaveCount(0)
}

async function openHevy(page: Page) {
  await nav(page, 'Configurações').click()
  await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible()
  // Its name grows with the "N para confirmar" chip once something is pending.
  await page.getByRole('navigation', { name: 'Outras configurações' }).getByRole('link', { name: /^Hevy\b/ }).click()
  await expect(page).toHaveURL(/\/configuracoes\/hevy$/)
  await expect(page.getByRole('heading', { name: 'Hevy', exact: true })).toBeVisible()
}

test('connects Hevy, imports a workout, sees it in the history and on Hoje, then removes the connection', async ({ page }) => {
  await login(page)
  await expectSynced(page)

  // Configurações → Hevy: not connected yet, the server has its encryption key.
  await openHevy(page)
  const main = page.getByRole('main')
  const form = main.getByRole('form', { name: 'Conectar ao Hevy' })
  await expect(form).toBeVisible()
  await form.getByLabel('Chave da API do Hevy').fill(KEY)
  const connected = page.waitForResponse(isHevy('PUT'))
  await form.getByRole('button', { name: 'Conectar', exact: true }).click()
  expect((await connected).status()).toBe(200)
  await expect(main.getByText('Conectado · chave terminada em 0001', { exact: true })).toBeVisible()
  // The key never stays in the page.
  await expect(page.getByLabel('Chave da API do Hevy')).toHaveCount(0)

  // "Sincronizar agora" (the page's, not the header's): the server imports the workout, then the device pulls it.
  const syncButton = main.getByRole('button', { name: 'Sincronizar agora', exact: true })
  const synced = page.waitForResponse(isHevy('POST', '/sync'))
  await syncButton.click()
  expect((await synced).status()).toBe(200)
  await expect(main.getByRole('status').filter({ hasText: /^1 importado, 0 atualizados, 0 removidos$/ })).toBeVisible()
  // The button is busy until the device's pull ends.
  await expect(syncButton).toBeEnabled()
  await expectSynced(page)
  // The exercise the sheet does not have waits for confirmation.
  await expect(main.getByRole('link', { name: 'Exercícios do Hevy para confirmar (1)', exact: true })).toBeVisible()

  // Histórico: the imported session carries the "Hevy" chip; the app session workout.spec.ts logged today is the same day.
  await nav(page, 'Treino').click()
  await page.getByRole('link', { name: 'Histórico de treinos' }).click()
  await expect(page.getByRole('heading', { name: 'Histórico de treinos' })).toBeVisible()
  const sessions = page.getByRole('region', { name: 'Sessões' })
  await expect(sessions.getByText('Hevy', { exact: true })).toBeVisible()
  await expect(sessions.getByText('Treino registrado no app e no Hevy', { exact: true })).toBeVisible()

  // Hoje: the workout of the day is done.
  await nav(page, 'Hoje').click()
  await expect(page.getByRole('heading', { name: 'Hoje' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Itens de hoje' }).getByRole('listitem', { name: DAY, exact: true }).getByText('Feito', { exact: true })).toBeVisible()

  // "Remover": the key is deleted on the server, the page offers to connect again.
  await openHevy(page)
  await main.getByRole('button', { name: 'Remover', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Remover a conexão com o Hevy?' })
  const removed = page.waitForResponse(isHevy('DELETE'))
  await sheet.getByRole('button', { name: 'Remover', exact: true }).click()
  expect((await removed).status()).toBe(204)
  await expect(sheet).toHaveCount(0)
  await expect(main.getByRole('status').filter({ hasText: /^Conexão com o Hevy removida\.$/ })).toBeVisible()
  await expect(main.getByRole('form', { name: 'Conectar ao Hevy' })).toBeVisible()

  // Read again from the server: disconnected.
  await nav(page, 'Hoje').click()
  await openHevy(page)
  await expect(main.getByRole('form', { name: 'Conectar ao Hevy' })).toBeVisible()
  await expect(main.getByText(/^Conectado/)).toHaveCount(0)
})
