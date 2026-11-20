import { createHash } from 'node:crypto'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
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

// The e2e backend runs with ExerciseCatalog disabled (no call to ExerciseDB): CI seeds its catalog with a single fictitious
// item (fixtures/exercise-catalog.sql), the pair of the dictionary's "Supino reto" (its id). The app gets it from the real
// GET /api/exercise-catalog, so the server keeps the draft's link; only the GIF (ExerciseDB's site) is served by the test.
const GIF_URL = 'https://static.exercisedb.dev/media/test.gif'
const TINY_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

async function stubGif(context: BrowserContext) {
  await context.route(GIF_URL, (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: TINY_GIF }))
}

/** The calendar date (yyyy-MM-dd) `offset` days from today in America/Sao_Paulo (the browser's timezone, playwright.config.ts). */
function saoPauloDate(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  return new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10)
}

const pdfFile = (name: string, buffer: Buffer) => ({ name, mimeType: 'application/pdf', buffer })

/** Waits for the header to say "Sincronizado" with nothing pending (the label only shows after a complete, successful run). */
async function expectSynced(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Sincronizado$/ })).toBeVisible()
  await expect(page.locator('header').getByText(/pendente/)).toHaveCount(0)
}

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name, exact: true })

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

// Assumes a fresh database (CI starts one per run): no session exists yet (workouts are logged in Hevy; hevy.spec.ts imports
// one later). The other projects depend on what this test leaves: the protocol active with its cycle from yesterday and
// the sheet active today with day A ("Treino A - Exemplo") as today's workout.
test('imports the protocol and a workout plan, sees today on the Treino tab, swaps the day and back', async ({ browser }) => {
  const context = await browser.newContext()
  await stubGif(context)
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
  // The cycle starts yesterday, so today.spec.ts can fix yesterday on Hoje (the limit back is the cycle's start).
  await page.getByLabel('Início do ciclo').fill(saoPauloDate(-1))
  await activate(page, 'Protocolo')

  await importOnDevice(page, 'Treino', pdfFile('treino-ficticio.pdf', workoutPdf()))
  await expect(page.getByRole('heading', { name: 'Revisar treino' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Rotação' })).toBeVisible()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByLabel('Nome do dia')).toHaveValue('Treino A - Exemplo')
  // The wrapped line is one exercise with its rest; the exercise without sets inherits the day's, marked for review.
  await expect(page.getByRole('button', { name: 'Editar Exercicio Ficticio Gama' }).locator('..')).toContainText('descanso 60 s')
  // The dictionary knows "Supino reto": its group and the "+ drop" of the sheet show on the row as tags.
  const supinoRow = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Editar Supino reto' }) })
  await expect(supinoRow.getByText('Peito', { exact: true })).toBeVisible()
  await supinoRow.getByRole('button', { name: 'Drop', exact: true }).click()
  await expect(supinoRow.getByRole('note')).toContainText('reduza a carga')
  await page.getByRole('button', { name: 'Confirmar dia' }).click()
  await expect(page.getByLabel('Nome do dia')).toHaveValue('Treino B - Exemplo')
  await expect(page.getByText('Confira').first()).toBeVisible()
  const sstRow = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Editar Exercicio Ficticio Delta' }) })
  await expect(sstRow.getByRole('button', { name: 'SST', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar dia' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Exercícios novos' })).toBeVisible()
  await expect(page.getByText('Supino reto').first()).toBeVisible()
  // The draft kept the dictionary's catalog link (the server has the item), so activation gives the exercise its media.
  await expect(page.getByText('Par: barbell bench press')).toBeVisible()
  // ...and its demonstration (the GIF comes from ExerciseDB's site; here, the stub).
  const pair = page.getByRole('listitem').filter({ hasText: 'Par: barbell bench press' })
  await expect(pair.getByRole('button', { name: 'Ampliar demonstração de Supino reto' })).toBeVisible()
  await expect(pair.locator(`img[src="${GIF_URL}"]`)).toHaveCount(1)
  await stepToActivate(page)
  await activate(page, 'Treino')

  // Nothing went to the AI.
  const after = (await (await page.request.get(`${ANTHROPIC_STUB}/__requests`)).json()) as StubRequest[]
  expect(after.length).toBe(before.length)

  // The rotation is anchored on the activation date, so day A is today whatever the weekday. The Treino tab only looks
  // things up: today's planned day with its swap, the charts and the history (empty: nothing was logged yet).
  await expectSynced(page)
  await nav(page, 'Treino').click()
  await expect(page).toHaveURL(/\/treino$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Treino', exact: true })).toBeVisible()
  await expect(page.getByText('Previsto hoje: Treino A - Exemplo', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Começar treino' })).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 2, name: 'Treinos por semana' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Treinos por semana' }).getByText(/^Semana de \d{2}\/\d{2}: 0 de [1-9]\d*$/)).toHaveCount(1)
  await expect(page.getByRole('table', { name: 'Calendário do ciclo' }).locator('[aria-label*="hoje, treino previsto"]')).toBeVisible()
  await expect(page.getByText('Sem cargas registradas no período.', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Histórico', exact: true }).getByText('Nenhum treino registrado ainda.')).toBeVisible()

  // "Trocar": today's swap to day B is saved (and synced); then back to day A, which the other projects expect today.
  await page.getByRole('button', { name: 'Trocar', exact: true }).click()
  const swap = page.getByRole('region', { name: 'Trocar o treino de hoje' })
  await expect(swap.getByRole('button', { name: 'Descanso', exact: true })).toBeVisible()
  await swap.getByRole('button', { name: /^Treino B - Exemplo/ }).click()
  await expect(swap).toHaveCount(0)
  await expect(page.getByText('Previsto hoje: Treino B - Exemplo', { exact: true })).toBeVisible()
  await expectSynced(page)
  await page.getByRole('button', { name: 'Trocar', exact: true }).click()
  await swap.getByRole('button', { name: /^Treino A - Exemplo/ }).click()
  await expect(swap).toHaveCount(0)
  await expect(page.getByText('Previsto hoje: Treino A - Exemplo', { exact: true })).toBeVisible()
  await expectSynced(page)

  // The summary: today is planned (day A) and nothing is done yet.
  await nav(page, 'Resumo').click()
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible()
  await expect(page.getByText(/Faltam \d+ dias para a atualização/)).toBeVisible()
  // "Treinos": the figure (first <dd>) is the count done, the caption says how many were planned.
  const workouts = page.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Treinos$/ }) }).locator('dd')
  await expect(workouts.first()).toHaveText('0')
  await expect(workouts.nth(1)).toHaveText('de 1 previsto')
  await expect(page.locator('[aria-label*="hoje, treino previsto"]')).toBeVisible()

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
