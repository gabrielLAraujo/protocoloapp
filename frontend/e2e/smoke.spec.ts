import { expect, test, type Page, type Response } from '@playwright/test'
import { login as signIn } from './support/auth.ts'

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

async function login(page: Page) {
  // "/" is the summary; the check-in is opened from Hoje ("Check-in da noite").
  await signIn(page)
  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Hoje' }).click()
  await expect(page).toHaveURL(/\/hoje$/)
  await page.getByRole('link', { name: 'Check-in da noite' }).click()
  await expect(page).toHaveURL(/\/checkin$/)
  await expect(page.getByRole('heading', { name: 'Check-in de hoje' })).toBeVisible()
}

/** Clicks the label of one option of a radio group (the radio inputs themselves are visually hidden). */
async function choose(page: Page, group: string, option: string) {
  await page.getByRole('radiogroup', { name: group }).getByText(option, { exact: true }).click()
}

function option(page: Page, group: string, name: string) {
  return page.getByRole('radiogroup', { name: group }).getByRole('radio', { name, exact: true })
}

test('offline checkin syncs to a second browser', async ({ browser }) => {
  // Device A: signs in online, then loses the network and saves today's check-in.
  const contextA = await browser.newContext()
  const a = await contextA.newPage()
  const seenByA = watch(a)
  const firstPull = a.waitForResponse((r) => isPull(r) && r.status() === 200)
  await login(a)
  await firstPull
  await expectSynced(a, seenByA)

  await contextA.setOffline(true)
  await choose(a, 'Sono (1–5)', '4')
  await choose(a, 'Intestino', 'Normal')
  await choose(a, 'Disposição ao acordar (1–5)', '3')
  await choose(a, 'Disposição no dia (1–5)', '4')
  await choose(a, 'Ansiedade (1–5)', '2')
  await a.getByLabel('Água (litros)').fill('2,5')
  await a.getByLabel('Peso (kg, opcional)').fill('82,4')
  await a.getByLabel('Observações').fill('Check-in do teste e2e')
  await a.getByRole('button', { name: 'Salvar' }).click()

  await expect(a.getByText('Salvo — será sincronizado')).toBeVisible()
  // The check-in and the marks of its two parts ("Check-in da manhã" and "Check-in da noite" done).
  await expect(a.getByText('Offline — 3 pendentes')).toBeVisible()

  // The network comes back: the pending change is sent (the 'online' event may already start the run).
  const pushed = a.waitForResponse(isPush)
  await contextA.setOffline(false)
  await a.getByRole('button', { name: 'Sincronizar agora' }).click()
  expect((await pushed).status()).toBe(200)
  await expectSynced(a, seenByA)

  // Device B: another browser profile signs in and receives the same check-in. Its first pull brings the record and the
  // open form refreshes itself (no navigation needed).
  const contextB = await browser.newContext()
  const b = await contextB.newPage()
  const seenByB = watch(b)
  const pulled = b.waitForResponse(pullWithRecords)
  await login(b)
  try {
    await pulled
    await expect(option(b, 'Sono (1–5)', '4')).toBeChecked()
  } catch (error) {
    throw new Error(`B API[${seenByB.join(' ; ')}] ${(error as Error).message}`)
  }

  await expect(option(b, 'Intestino', 'Normal')).toBeChecked()
  await expect(option(b, 'Disposição ao acordar (1–5)', '3')).toBeChecked()
  await expect(option(b, 'Disposição no dia (1–5)', '4')).toBeChecked()
  await expect(option(b, 'Ansiedade (1–5)', '2')).toBeChecked()
  await expect(b.getByLabel('Água (litros)')).toHaveValue('2.5')
  await expect(b.getByLabel('Peso (kg, opcional)')).toHaveValue('82.4')
  await expect(b.getByLabel('Observações')).toHaveValue('Check-in do teste e2e')

  await contextA.close()
  await contextB.close()
})
