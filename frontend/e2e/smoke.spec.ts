import { expect, test, type Page } from '@playwright/test'

// The user is created beforehand with `create-user` (CI does it); fictitious credentials.
const EMAIL = process.env.E2E_EMAIL ?? 'e2e@example.com'
const PASSWORD = process.env.E2E_PASSWORD ?? 'Senha-e2e-123456'

async function login(page: Page) {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('E-mail').fill(EMAIL)
  await page.getByLabel('Senha').fill(PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()
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
  await login(a)
  await expect(a.getByText('Sincronizado', { exact: true })).toBeVisible()

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
  await expect(a.getByText('Offline — 1 pendente')).toBeVisible()

  // The network comes back: the pending change is sent.
  await contextA.setOffline(false)
  await a.getByRole('button', { name: 'Sincronizar agora' }).click()
  await expect(a.getByText('Sincronizado', { exact: true })).toBeVisible()

  // Device B: another browser profile signs in and receives the same check-in.
  const contextB = await browser.newContext()
  const b = await contextB.newPage()
  await login(b)

  // The form reads the local database when it opens, so leave the screen and come back until the first pull has landed.
  // (In-app navigation, not a reload: a reload would restart the token refresh and could cut it halfway.)
  await expect(async () => {
    await b.getByRole('link', { name: 'Diagnóstico' }).click()
    await b.goBack()
    await expect(option(b, 'Sono (1–5)', '4')).toBeChecked({ timeout: 2_000 })
  }).toPass({ timeout: 45_000 })

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
