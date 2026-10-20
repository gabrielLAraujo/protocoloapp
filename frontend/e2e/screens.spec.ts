import { expect, test, type Page } from '@playwright/test'
import { login } from './support/auth.ts'

// Screenshots of the main screens, light and dark, at iPhone size: the viewport as it looks (fixed header and bottom nav)
// and the whole page (bottom nav hidden, it would sit in the middle of a full-page capture). Runs after the other specs
// (project `screenshots` in playwright.config.ts depends on them), so the fictitious protocol, workout and session they
// created are on screen. Only reads: nothing is marked or saved. CI uploads the folder as the `screenshots` artifact; the
// PNGs are never committed (.gitignore).
const OUT = 'e2e-screenshots'
const HIDE_NAV = 'nav[aria-label="Navegação principal"] { display: none !important; }'

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name })

async function shoot(page: Page, name: string) {
  // Let late renders (sync results) settle, then the same screen in both themes.
  await page.waitForLoadState('networkidle').catch(() => undefined)
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.screenshot({ path: `${OUT}/${name}-${scheme}.png` })
    const style = await page.addStyleTag({ content: HIDE_NAV })
    await page.screenshot({ path: `${OUT}/${name}-${scheme}-full.png`, fullPage: true })
    await style.evaluate((el) => el.remove())
  }
}

// One sign-in for both themes: the auth endpoints are rate limited per IP (see support/auth.ts).
test('screenshots of the main screens, light and dark', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
  const page = await context.newPage()

  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible()
  await shoot(page, '0-login')

  await login(page)
  await expect(page.getByRole('status').filter({ hasText: /^Sincronizado$/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Ciclo', exact: true })).toBeVisible()
  await shoot(page, '1-resumo')

  await nav(page, 'Hoje').click()
  await expect(page.getByRole('list', { name: 'Itens de hoje' })).toBeVisible()
  // The day's ring, the streak and the week card (loaded after the list).
  await expect(page.getByRole('progressbar', { name: 'Progresso do dia' })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Sequência: / })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Semana' })).toBeVisible()
  await shoot(page, '2-hoje')

  await page.getByRole('link', { name: 'Check-in da manhã' }).click()
  await expect(page.getByRole('heading', { name: 'Check-in da manhã' })).toBeVisible()
  await shoot(page, '2b-checkin-manha')

  await page.goto('/checkin')
  await expect(page.getByRole('heading', { name: 'Check-in de hoje' })).toBeVisible()
  await shoot(page, '2c-checkin')

  await nav(page, 'Treino').click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await shoot(page, '3-treino')

  await nav(page, 'Planejamento').click()
  await expect(page.getByRole('heading', { name: 'Planejamento' })).toBeVisible()
  await shoot(page, '4-planejamento')

  await page.getByRole('button', { name: 'Mais' }).click()
  await page.getByRole('dialog', { name: 'Mais' }).getByRole('link', { name: 'Conquistas' }).click()
  await expect(page.getByRole('heading', { name: 'Conquistas' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Sequência' })).toBeVisible()
  await shoot(page, '4b-conquistas')

  await page.getByRole('button', { name: 'Mais' }).click()
  await page.getByRole('dialog', { name: 'Mais' }).getByRole('link', { name: 'Configurações' }).click()
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible()
  await shoot(page, '5-configuracoes')

  await context.close()
})
