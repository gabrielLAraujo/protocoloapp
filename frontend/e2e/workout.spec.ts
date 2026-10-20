import { createHash } from 'node:crypto'
import { expect, test, type Page, type Response } from '@playwright/test'
// @ts-expect-error plain JS fixture builder, no types
import { protocolPdf, scannedPdf, workoutPdf } from './fixtures/make-pdfs.mjs'
import { login } from './support/auth.ts'

// The Anthropic stand-in the API talks to (CI starts it); it also lists what it received.
const ANTHROPIC_STUB = process.env.E2E_ANTHROPIC_STUB_URL ?? 'http://127.0.0.1:9100'

interface StubRequest {
  tool: string | null
  pdfMediaType: string | null
  pdfBytes: number
  pdfIsPdf: boolean
  pdfSha256: string | null
}

const pdfFile = (name: string, buffer: Buffer) => ({ name, mimeType: 'application/pdf', buffer })

const isPush = (response: Response) => response.url().includes('/api/sync/push') && response.request().method() === 'POST'

/** Waits for the header to say "Sincronizado" with nothing pending (the label only shows after a complete, successful run). */
async function expectSynced(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Sincronizado$/ })).toBeVisible()
  await expect(page.locator('header').getByText(/pendente/)).toHaveCount(0)
}

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name })

/** Sends a PDF in the card of `title`: the device reads it (pdf.js worker) and creates the draft; the review opens. */
async function importOnDevice(page: Page, title: 'Protocolo' | 'Treino', file: { name: string; mimeType: string; buffer: Buffer }) {
  await nav(page, 'Planejamento').click()
  await expect(page.getByRole('heading', { name: 'Planejamento' })).toBeVisible()
  const created = page.waitForResponse((r) => r.url().endsWith('/api/plans/drafts') && r.request().method() === 'POST')
  await page.getByRole('region', { name: title }).locator('input[type=file]').setInputFiles(file)
  expect((await created).status()).toBe(201)
  await expect(page).toHaveURL(/\/planejamento\/revisao\//)
}

/** Goes through the review steps (Rotação, the days, Exercícios novos) confirming each day, up to the last step. */
async function stepToActivate(page: Page) {
  const label = page.getByText(/^Etapa \d+ de \d+$/)
  for (let i = 0; i < 20; i++) {
    const [current, total] = ((await label.textContent()) ?? '').match(/\d+/g)!.map(Number)
    if (current === total) return
    await page.getByRole('button', { name: /^(Continuar|Confirmar dia|Próximo)$/ }).click()
    await expect(label).not.toHaveText(`Etapa ${current} de ${total}`)
  }
  throw new Error('the review has more steps than expected')
}

/** Activates the draft on screen and waits for the planning page to show it active. */
async function activate(page: Page, title: 'Protocolo' | 'Treino') {
  const button = page.getByRole('button', { name: 'Ativar', exact: true })
  await expect(button).toBeEnabled()
  const activated = page.waitForResponse((r) => /\/api\/plans\/[^/]+\/activate$/.test(r.url()) && r.request().method() === 'POST')
  await button.click()
  expect((await activated).status()).toBe(200)
  await expect(page).toHaveURL(/\/planejamento$/)
  await expect(page.getByRole('region', { name: title }).getByText(/^Ativo desde/)).toBeVisible()
}

// Assumes a fresh database (CI starts one per run): the summary expects exactly one finished workout today. The browser
// timezone (America/Sao_Paulo, playwright.config.ts) matches the stub's "today" (UTC-3), so midnight cannot split them.
test('imports a workout plan, logs a session offline and sees it in the summary', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const before = (await (await page.request.get(`${ANTHROPIC_STUB}/__requests`)).json()) as StubRequest[]

  await login(page)
  await expectSynced(page)

  // Protocol (its update date in 30 days, so the summary shows the cycle) and workout, both read on the device.
  await importOnDevice(page, 'Protocolo', pdfFile('protocolo-ficticio.pdf', protocolPdf()))
  await expect(page.getByRole('heading', { name: 'Revisar protocolo' })).toBeVisible()
  await expect(page.getByLabel('Fase', { exact: true })).toHaveValue('Fase Ficticia')
  await expect(page.getByLabel('Nome da refeição').first()).toHaveValue('Refeicao 1')
  // The dates have no year in the PDF: inferred, so marked for review.
  await expect(page.getByText('Confira').first()).toBeVisible()
  await activate(page, 'Protocolo')

  await importOnDevice(page, 'Treino', pdfFile('treino-ficticio.pdf', workoutPdf()))
  await expect(page.getByRole('heading', { name: 'Revisar treino' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Rotação' })).toBeVisible()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByLabel('Nome do dia')).toHaveValue('Treino A - Exemplo')
  // The wrapped line is one exercise with its rest; the exercise without sets inherits the day's, marked for review.
  await expect(page.getByRole('button', { name: 'Editar Exercicio Ficticio Gama' }).locator('..')).toContainText('descanso 60 s')
  await page.getByRole('button', { name: 'Confirmar dia' }).click()
  await expect(page.getByLabel('Nome do dia')).toHaveValue('Treino B - Exemplo')
  await expect(page.getByText('Confira').first()).toBeVisible()
  await stepToActivate(page)
  await activate(page, 'Treino')

  // Nothing went to the AI.
  const after = (await (await page.request.get(`${ANTHROPIC_STUB}/__requests`)).json()) as StubRequest[]
  expect(after.length).toBe(before.length)

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

// Runs after the test above (same project, file order): the plans are active, so this only leaves drafts behind.
test('a scanned PDF opens an empty draft to fill in, and "Ler com IA" reads the same file', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const scan = scannedPdf()
  const scanSha256 = createHash('sha256').update(scan).digest('hex')
  const before = (await (await page.request.get(`${ANTHROPIC_STUB}/__requests`)).json()) as StubRequest[]

  await login(page)
  await expectSynced(page)

  await importOnDevice(page, 'Treino', pdfFile('escaneado.pdf', scan))
  await expect(page.getByText('Esse PDF não tem texto selecionável. Preencha à mão.')).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Rotação' })).toBeVisible()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByRole('button', { name: 'Ativar', exact: true })).toBeDisabled()
  const firstDraft = page.url()

  // CI configures the AI (pointing at the stub): the review offers it on the same file.
  const imported = page.waitForResponse((r) => r.url().endsWith('/api/plans/import') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Ler com IA' }).click()
  expect((await imported).status()).toBe(201)
  await expect(page).not.toHaveURL(firstDraft)
  // The new draft has days (the scanned one had none: 2 steps), so it has more steps.
  await expect(page.getByText(/^Etapa 1 de ([3-9]|\d{2})$/)).toBeVisible()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByLabel('Nome do dia')).toHaveValue('Treino A - Exemplo')
  await expect(page.getByText('Esse PDF não tem texto selecionável. Preencha à mão.')).toHaveCount(0)

  const received = ((await (await page.request.get(`${ANTHROPIC_STUB}/__requests`)).json()) as StubRequest[]).slice(before.length)
  expect(received.map((r) => r.tool)).toEqual(['submit_workout'])
  expect(received[0]).toMatchObject({ pdfMediaType: 'application/pdf', pdfIsPdf: true, pdfSha256: scanSha256 })

  await context.close()
})
