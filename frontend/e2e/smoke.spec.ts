import { expect, test, type Page, type Response } from '@playwright/test'
import { login as signIn } from './support/auth.ts'

// Runs in the `today` project, after `chromium` (playwright.config.ts): offline.spec.ts saved only today's evening part
// and workout.spec.ts activated the fictitious protocol today. Assumes the fresh database CI starts per run.

/** Remembers what the page asked of the API, so a failed wait can say what happened (CI cannot download traces). */
function watch(page: Page) {
  const seen: string[] = []
  page.on('response', (response) => {
    if (!response.url().includes('/api/')) return
    const line = `${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`
    if (!response.url().includes('/api/sync/pull')) return void seen.push(line)
    void response.json().then(
      (body: { records?: unknown[] }) => seen.push(`${line} records=${body.records?.length ?? '?'}`),
      () => seen.push(line),
    )
  })
  page.on('requestfailed', (request) => seen.push(`FAILED ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`))
  page.on('console', (message) => {
    if (message.type() === 'error') seen.push(`console.error ${message.text().slice(0, 160)}`)
  })
  return seen
}

const isPull = (response: Response) => response.url().includes('/api/sync/pull') && response.request().method() === 'GET'
const isPush = (response: Response) => response.url().includes('/api/sync/push') && response.request().method() === 'POST'

/** A pull answered 200 with at least one record. */
async function pullWithRecords(response: Response) {
  if (!isPull(response) || response.status() !== 200) return false
  const body = (await response.json().catch(() => ({}))) as { records?: unknown[] }
  return (body.records?.length ?? 0) >= 1
}

/**
 * Waits for the header to say "Sincronizado" with nothing pending. The label only appears after a complete run (push and
 * pull) that did not fail, so it is a real sync, not the idle state. On timeout the error carries the header text and the
 * recent API calls.
 */
async function expectSynced(page: Page, seen: string[]) {
  try {
    await expect(page.getByRole('status').filter({ hasText: /^Sincronizado$/ })).toBeVisible()
    await expect(page.locator('header').getByText(/pendente/)).toHaveCount(0)
  } catch (error) {
    const header = (await page.locator('header').innerText()).replace(/\s+/g, ' ')
    throw new Error(`HEADER[${header}] API[${seen.slice(-12).join(' ; ')}] ${(error as Error).message}`)
  }
}

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name })
const ring = (page: Page) => page.getByRole('progressbar', { name: 'Progresso do dia' })
const hojeRow = (page: Page, name: string) => page.getByRole('listitem', { name })

/** Signs in and opens Hoje ("/" is the summary). */
async function login(page: Page) {
  await signIn(page)
  await nav(page, 'Hoje').click()
  await expect(page).toHaveURL(/\/hoje$/)
}

/** Opens a part of today's check-in from its row on Hoje. */
async function openPart(page: Page, row: 'Check-in da manhã' | 'Check-in da noite', path: RegExp) {
  await page.getByRole('link', { name: row, exact: true }).click()
  await expect(page).toHaveURL(path)
  await expect(page.getByRole('heading', { name: row })).toBeVisible()
}

/** Clicks the label of one option of a radio group (the radio inputs themselves are visually hidden). */
async function choose(page: Page, group: string, option: string) {
  await page.getByRole('radiogroup', { name: group }).getByText(option, { exact: true }).click()
}

/** Resumo's "Check-ins" card: days of the cycle with both parts saved. */
async function expectCheckinCount(page: Page, count: string) {
  await nav(page, 'Resumo').click()
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible()
  // The value is the first <dd> of the row; its subtitle ("no ciclo") is a second one.
  const card = page.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Check-ins$/ }) }).locator('dd').first()
  await expect(card).toHaveText(count)
  await nav(page, 'Hoje').click()
  await expect(page).toHaveURL(/\/hoje$/)
}

/** The day ring's value (0–100). */
async function ringValue(page: Page): Promise<number> {
  await expect(ring(page)).toHaveAttribute('aria-valuenow', /^\d+$/)
  return Number(await ring(page).getAttribute('aria-valuenow'))
}

function option(page: Page, group: string, name: string) {
  return page.getByRole('radiogroup', { name: group }).getByRole('radio', { name, exact: true })
}

test('offline checkin, morning then evening, syncs to a second browser', async ({ browser }) => {
  // Device A: signs in online, then loses the network and saves today's check-in in its two parts.
  const contextA = await browser.newContext()
  const a = await contextA.newPage()
  const seenByA = watch(a)
  const firstPull = a.waitForResponse((r) => isPull(r) && r.status() === 200)
  await login(a)
  await firstPull
  // Opening Hoje may create the default reminder times and sync them: let that finish before the network goes.
  await expectSynced(a, seenByA)

  // offline.spec.ts (same user, runs before) saved today's evening part; nothing has saved the morning yet. The protocol
  // workout.spec.ts activated today starts the cycle, so Resumo counts no complete check-in yet.
  await expect(hojeRow(a, 'Check-in da manhã').getByText('Feito', { exact: true })).toHaveCount(0)
  const ringBefore = await ringValue(a)
  await expectCheckinCount(a, '0')

  await contextA.setOffline(true)
  await openPart(a, 'Check-in da manhã', /\/checkin\/manha$/)
  await choose(a, 'Sono (1–5)', '4')
  await choose(a, 'Disposição ao acordar (1–5)', '3')
  await choose(a, 'Intestino', 'Normal')
  await a.getByLabel('Peso (kg, opcional)').fill('82,4')
  await a.getByRole('button', { name: 'Salvar' }).click()

  // Back on Hoje: the morning row is done.
  await expect(a).toHaveURL(/\/hoje$/)
  await expect(a.getByText('Check-in da manhã salvo — será sincronizado')).toBeVisible()
  await expect(hojeRow(a, 'Check-in da manhã').getByText('Feito', { exact: true })).toBeVisible()
  // The morning part and its mark.
  await expect(a.getByText('Offline — 2 pendentes')).toBeVisible()

  await openPart(a, 'Check-in da noite', /\/checkin\/noite$/)
  await choose(a, 'Disposição no dia (1–5)', '4')
  await choose(a, 'Ansiedade (1–5)', '2')
  await a.getByLabel('Água (litros)').fill('2,5')
  await a.getByLabel('Observações').fill('Check-in do teste e2e')
  await a.getByRole('button', { name: 'Salvar' }).click()

  await expect(a).toHaveURL(/\/hoje$/)
  await expect(a.getByText('Check-in da noite salvo — será sincronizado')).toBeVisible()
  await expect(hojeRow(a, 'Check-in da noite').getByText('Feito', { exact: true })).toBeVisible()
  await expect(a.getByText('Offline — 4 pendentes')).toBeVisible()

  // The network comes back: the pending changes are sent (the 'online' event may already start the run).
  const pushed = a.waitForResponse(isPush)
  await contextA.setOffline(false)
  await a.getByRole('button', { name: 'Sincronizar agora' }).click()
  expect((await pushed).status()).toBe(200)
  await expectSynced(a, seenByA)

  // Both parts are done: the day ring went up (above 0) and Resumo counts one complete check-in.
  await expect.poll(async () => Number(await ring(a).getAttribute('aria-valuenow'))).toBeGreaterThan(Math.max(ringBefore, 0))
  await expectCheckinCount(a, '1')

  // Device B: another browser profile signs in and receives the same check-in. Its first pull brings the record and the
  // open Hoje refreshes itself (no navigation needed).
  const contextB = await browser.newContext()
  const b = await contextB.newPage()
  const seenByB = watch(b)
  const pulled = b.waitForResponse(pullWithRecords)
  await login(b)
  try {
    await pulled
    await expect(hojeRow(b, 'Check-in da manhã').getByText('Feito', { exact: true })).toBeVisible()
  } catch (error) {
    throw new Error(`B API[${seenByB.join(' ; ')}] ${(error as Error).message}`)
  }
  await expect(hojeRow(b, 'Check-in da noite').getByText('Feito', { exact: true })).toBeVisible()

  await openPart(b, 'Check-in da manhã', /\/checkin\/manha$/)
  await expect(option(b, 'Sono (1–5)', '4')).toBeChecked()
  await expect(option(b, 'Disposição ao acordar (1–5)', '3')).toBeChecked()
  await expect(option(b, 'Intestino', 'Normal')).toBeChecked()
  await expect(b.getByLabel('Peso (kg, opcional)')).toHaveValue('82.4')

  await nav(b, 'Hoje').click()
  await openPart(b, 'Check-in da noite', /\/checkin\/noite$/)
  await expect(option(b, 'Disposição no dia (1–5)', '4')).toBeChecked()
  await expect(option(b, 'Ansiedade (1–5)', '2')).toBeChecked()
  await expect(b.getByLabel('Água (litros)')).toHaveValue('2.5')
  await expect(b.getByLabel('Observações')).toHaveValue('Check-in do teste e2e')

  // The hub shows both parts done.
  await b.goto('/checkin')
  await expect(b.getByRole('heading', { name: 'Check-in de hoje' })).toBeVisible()
  await expect(b.getByRole('listitem', { name: 'Manhã' }).getByText('Feito', { exact: true })).toBeVisible()
  await expect(b.getByRole('listitem', { name: 'Noite' }).getByText('Feito', { exact: true })).toBeVisible()

  await contextA.close()
  await contextB.close()
})
