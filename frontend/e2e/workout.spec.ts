import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page, type Response } from '@playwright/test'

// The user is created beforehand with `create-user` (CI does it); fictitious credentials.
const EMAIL = process.env.E2E_EMAIL ?? 'e2e@example.com'
const PASSWORD = process.env.E2E_PASSWORD ?? 'Senha-e2e-123456'
// The Anthropic stand-in the API talks to (CI starts it); it also lists what it received.
const ANTHROPIC_STUB = process.env.E2E_ANTHROPIC_STUB_URL ?? 'http://127.0.0.1:9100'

const FIXTURE = fileURLToPath(new URL('./fixtures/ficha-ficticia.pdf', import.meta.url))

interface StubRequest {
  tool: string | null
  pdfMediaType: string | null
  pdfBytes: number
  pdfIsPdf: boolean
  pdfSha256: string | null
}

const isPush = (response: Response) => response.url().includes('/api/sync/push') && response.request().method() === 'POST'

/** Waits for the header to say "Sincronizado" with nothing pending (the label only shows after a complete, successful run). */
async function expectSynced(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Sincronizado$/ })).toBeVisible()
  await expect(page.locator('header').getByText(/pendente/)).toHaveCount(0)
}

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name })

async function login(page: Page) {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('E-mail').fill(EMAIL)
  await page.getByLabel('Senha').fill(PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible()
}

/** Sends the fictitious PDF in the card of `title`, reviews the draft the stub produced and activates it. */
async function importAndActivate(page: Page, title: 'Protocolo' | 'Treino') {
  await nav(page, 'Planejamento').click()
  await expect(page.getByRole('heading', { name: 'Planejamento' })).toBeVisible()
  const imported = page.waitForResponse((r) => r.url().includes('/api/plans/import') && r.request().method() === 'POST')
  await page.getByRole('region', { name: title }).locator('input[type=file]').setInputFiles(FIXTURE)
  expect((await imported).status()).toBe(201)

  await expect(page).toHaveURL(/\/planejamento\/revisao\//)
  const activate = page.getByRole('button', { name: 'Ativar', exact: true })
  await expect(activate).toBeEnabled()
  const activated = page.waitForResponse((r) => /\/api\/plans\/[^/]+\/activate$/.test(r.url()) && r.request().method() === 'POST')
  await activate.click()
  expect((await activated).status()).toBe(200)

  await expect(page).toHaveURL(/\/planejamento$/)
  await expect(page.getByRole('region', { name: title }).getByText(/^Ativo desde/)).toBeVisible()
}

// Assumes a fresh database (CI starts one per run): the summary expects exactly one finished workout today. The browser
// timezone (America/Sao_Paulo, playwright.config.ts) matches the stub's "today" (UTC-3), so midnight cannot split them.
test('imports a workout plan, logs a session offline and sees it in the summary', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const pdfSha256 = createHash('sha256').update(readFileSync(FIXTURE)).digest('hex')

  const before = (await (await page.request.get(`${ANTHROPIC_STUB}/__requests`)).json()) as StubRequest[]

  await login(page)
  await expectSynced(page)

  // Protocol (with its update date, so the summary shows the cycle) and workout: each PDF goes to the storage stub, the API
  // reads it through the Anthropic stub, and the draft is reviewed and activated.
  await importAndActivate(page, 'Protocolo')
  await importAndActivate(page, 'Treino')

  // The stub received both PDFs, byte for byte, with the forced tool of each kind.
  const received = ((await (await page.request.get(`${ANTHROPIC_STUB}/__requests`)).json()) as StubRequest[]).slice(before.length)
  expect(received.map((r) => r.tool)).toEqual(['submit_protocol', 'submit_workout'])
  for (const request of received) {
    expect(request.pdfMediaType).toBe('application/pdf')
    expect(request.pdfIsPdf).toBe(true)
    expect(request.pdfSha256).toBe(pdfSha256)
  }

  // The rotation is anchored on the activation date, so day A is today whatever the weekday.
  await nav(page, 'Treino').click()
  await expect(page.getByRole('heading', { name: 'Treino A - Exemplo' })).toBeVisible()
  const planned = page.getByRole('list', { name: 'Exercícios do dia' })
  await expect(planned.getByText('Exercicio Ficticio Alfa')).toBeVisible()
  await expect(planned.getByText('Exercicio Ficticio Gama')).toBeVisible()
  // The activation sync brought the new exercises to the device before the session starts.
  await expectSynced(page)
  await page.getByRole('button', { name: 'Começar treino' }).click()

  const card = page.getByRole('region', { name: 'Exercicio Ficticio Alfa' })
  await expect(card.getByLabel('Carga da série 1 (kg)')).toBeVisible()

  // Offline: two sets are saved on the device only.
  await context.setOffline(true)
  await card.getByLabel('Carga da série 1 (kg)').fill('60')
  await card.getByLabel('Repetições da série 1').fill('10')
  await card.getByRole('button', { name: 'Concluir série 1' }).click()
  await expect(card.getByRole('button', { name: 'Editar série 1' })).toBeVisible()
  await card.getByLabel('Carga da série 2 (kg)').fill('62,5')
  await card.getByLabel('Repetições da série 2').fill('8')
  await card.getByRole('button', { name: 'Concluir série 2' }).click()
  await expect(card.getByRole('button', { name: 'Editar série 2' })).toBeVisible()

  await page.getByRole('button', { name: 'Finalizar treino' }).click()
  await page.getByRole('button', { name: 'Sim, finalizar' }).click()
  await expect(page.getByRole('heading', { name: 'Treino finalizado' })).toBeVisible()
  await page.getByRole('button', { name: 'Concluir', exact: true }).click()
  await expect(page.getByText('Offline —')).toBeVisible()

  // Back online: the session and its sets are pushed.
  const pushed = page.waitForResponse(isPush)
  await context.setOffline(false)
  await page.getByRole('button', { name: 'Sincronizar agora' }).click()
  expect((await pushed).status()).toBe(200)
  await expectSynced(page)

  // The summary counts the workout and marks today as done.
  await nav(page, 'Resumo').click()
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible()
  await expect(page.getByText(/Faltam \d+ dias para a atualização/)).toBeVisible()
  await expect(page.getByText('1 de 1', { exact: true })).toBeVisible()
  await expect(page.locator('[aria-label*="hoje, treino feito"]')).toBeVisible()

  await context.close()
})
