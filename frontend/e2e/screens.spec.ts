import { expect, test, type Browser, type Page } from '@playwright/test'

// Full-page screenshots of the main screens, light and dark, at iPhone size. Runs after the other specs (project
// `screenshots` in playwright.config.ts depends on them), so the fictitious protocol, workout and session they created
// are on screen. Only reads: nothing is marked or saved. CI uploads the folder as the `screenshots` artifact; the PNGs
// are never committed (.gitignore).
const EMAIL = process.env.E2E_EMAIL ?? 'e2e@example.com'
const PASSWORD = process.env.E2E_PASSWORD ?? 'Senha-e2e-123456'
const OUT = 'e2e-screenshots'

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name })

async function shoot(page: Page, name: string, scheme: string) {
  // Let late renders (sync results, fonts) settle.
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.screenshot({ path: `${OUT}/${name}-${scheme}.png`, fullPage: true })
}

async function capture(browser: Browser, scheme: 'light' | 'dark') {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()

  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await shoot(page, '0-login', scheme)
  await page.getByLabel('E-mail').fill(EMAIL)
  await page.getByLabel('Senha').fill(PASSWORD)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /^Sincronizado$/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Ciclo' })).toBeVisible()
  await shoot(page, '1-resumo', scheme)

  await nav(page, 'Hoje').click()
  await expect(page.getByRole('list', { name: 'Itens de hoje' })).toBeVisible()
  await shoot(page, '2-hoje', scheme)

  await nav(page, 'Treino').click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await shoot(page, '3-treino', scheme)

  await nav(page, 'Planejamento').click()
  await expect(page.getByRole('heading', { name: 'Planejamento' })).toBeVisible()
  await shoot(page, '4-planejamento', scheme)

  await page.getByRole('button', { name: 'Mais' }).click()
  await page.getByRole('dialog', { name: 'Mais' }).getByRole('link', { name: 'Configurações' }).click()
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible()
  await shoot(page, '5-configuracoes', scheme)

  await context.close()
}

test('screenshots of the main screens, light', async ({ browser }) => {
  await capture(browser, 'light')
})

test('screenshots of the main screens, dark', async ({ browser }) => {
  await capture(browser, 'dark')
})
