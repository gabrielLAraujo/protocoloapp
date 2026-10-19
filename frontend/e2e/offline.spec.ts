import { expect, test, type Page } from '@playwright/test'

// The user is created beforehand with `create-user` (CI does it); fictitious credentials.
const EMAIL = process.env.E2E_EMAIL ?? 'e2e@example.com'
const PASSWORD = process.env.E2E_PASSWORD ?? 'Senha-e2e-123456'

/** Clicks the label of one option of a radio group (the radio inputs themselves are visually hidden). */
async function choose(page: Page, group: string, option: string) {
  await page.getByRole('radiogroup', { name: group }).getByText(option, { exact: true }).click()
}

test('the installed app shell opens offline with the saved check-in', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('E-mail').fill(EMAIL)
  await page.getByLabel('Senha').fill(PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()
  // "/" is the summary; the check-in lives at /checkin.
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible()
  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Check-in' }).click()
  await expect(page).toHaveURL(/\/checkin$/)
  await expect(page.getByRole('heading', { name: 'Check-in de hoje' })).toBeVisible()

  await choose(page, 'Sono (1–5)', '5')
  await choose(page, 'Intestino', 'Normal')
  await choose(page, 'Disposição ao acordar (1–5)', '2')
  await choose(page, 'Disposição no dia (1–5)', '3')
  await choose(page, 'Ansiedade (1–5)', '1')
  await page.getByLabel('Água (litros)').fill('3')
  await page.getByLabel('Peso (kg, opcional)').fill('79,9')
  await page.getByLabel('Observações').fill('Check-in do teste offline')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText(/^Salvo/)).toBeVisible()

  // The service worker is installed and active (the whole shell, wasm included, is precached by then).
  // (A string, not a function: the e2e files are type-checked without the DOM lib.)
  const registered = await page.evaluate('navigator.serviceWorker.ready.then((registration) => registration.active?.state)')
  expect(registered).toBe('activated')

  // Network gone: a full reload must still bring the app up, from the cache, with the data from the local database.
  await context.setOffline(true)
  await page.reload()

  await expect(page.getByRole('heading', { name: 'Check-in de hoje' })).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Sono (1–5)' }).getByRole('radio', { name: '5', exact: true })).toBeChecked()
  await expect(page.getByRole('radiogroup', { name: 'Intestino' }).getByRole('radio', { name: 'Normal', exact: true })).toBeChecked()
  await expect(page.getByLabel('Água (litros)')).toHaveValue('3')
  await expect(page.getByLabel('Peso (kg, opcional)')).toHaveValue('79.9')
  await expect(page.getByLabel('Observações')).toHaveValue('Check-in do teste offline')

  await context.close()
})
