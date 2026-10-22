import { expect, test, type Page } from '@playwright/test'
import { login } from './support/auth.ts'

/** Clicks the label of one option of a radio group (the radio inputs themselves are visually hidden). */
async function choose(page: Page, group: string, option: string) {
  await page.getByRole('radiogroup', { name: group }).getByText(option, { exact: true }).click()
}

test('the installed app shell opens offline with the saved evening check-in', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  // "/" is the summary; the evening check-in is opened from Hoje ("Check-in da noite").
  await login(page)
  await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Hoje', exact: true }).click()
  await expect(page).toHaveURL(/\/hoje$/)
  await page.getByRole('link', { name: 'Check-in da noite', exact: true }).click()
  await expect(page).toHaveURL(/\/checkin\/noite$/)
  await expect(page.getByRole('heading', { name: 'Check-in da noite' })).toBeVisible()

  await choose(page, 'Disposição no dia (1–5)', '3')
  await choose(page, 'Ansiedade (1–5)', '1')
  await page.getByLabel('Água (litros)').fill('3')
  await page.getByLabel('Observações').fill('Check-in do teste offline')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page).toHaveURL(/\/hoje$/)
  await expect(page.getByText('Check-in da noite salvo — será sincronizado')).toBeVisible()

  // The service worker is installed and active (the whole shell, wasm included, is precached by then).
  // (A string, not a function: the e2e files are type-checked without the DOM lib.)
  const registered = await page.evaluate('navigator.serviceWorker.ready.then((registration) => registration.active?.state)')
  expect(registered).toBe('activated')

  // Network gone: a full reload must still bring the app up, from the cache, with the data from the local database.
  await context.setOffline(true)
  await page.reload()

  // Hoje comes back from the cache with the evening row done, and the form with the saved values.
  await expect(page.getByRole('heading', { name: 'Hoje' })).toBeVisible()
  await expect(page.getByRole('listitem', { name: 'Check-in da noite' }).getByText('Feito', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Check-in da noite', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Check-in da noite' })).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Disposição no dia (1–5)' }).getByRole('radio', { name: '3', exact: true })).toBeChecked()
  await expect(page.getByRole('radiogroup', { name: 'Ansiedade (1–5)' }).getByRole('radio', { name: '1', exact: true })).toBeChecked()
  await expect(page.getByLabel('Água (litros)')).toHaveValue('3')
  await expect(page.getByLabel('Observações')).toHaveValue('Check-in do teste offline')

  await context.close()
})
