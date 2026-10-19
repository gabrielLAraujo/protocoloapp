import { expect, test, type Page } from '@playwright/test'
import { login } from './support/auth.ts'

/** Clicks the label of one option of a radio group (the radio inputs themselves are visually hidden). */
async function choose(page: Page, group: string, option: string) {
  await page.getByRole('radiogroup', { name: group }).getByText(option, { exact: true }).click()
}

test('the installed app shell opens offline with the saved check-in', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  // "/" is the summary; the check-in is opened from Hoje ("Check-in da noite").
  await login(page)
  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Hoje' }).click()
  await expect(page).toHaveURL(/\/hoje$/)
  await page.getByRole('link', { name: 'Check-in da noite' }).click()
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
