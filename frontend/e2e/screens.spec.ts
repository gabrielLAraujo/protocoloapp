import { expect, test, type Page } from '@playwright/test'
import { login } from './support/auth.ts'

// Screenshots of the main screens, light and dark, at iPhone size (390x844), then a few in light theme at desktop size
// (1280x800, the sidebar layout from 1024 px): the viewport as it looks (fixed header and bottom nav)
// and the whole page (bottom nav hidden, it would sit in the middle of a full-page capture). Runs after the other specs
// (project `screenshots` in playwright.config.ts depends on them), so the fictitious protocol, workout and session they
// created are on screen. Only reads: nothing is marked or saved. CI uploads the folder as the `screenshots` artifact; the
// PNGs are never committed (.gitignore).
const OUT = 'e2e-screenshots'
const HIDE_NAV = 'nav[aria-label="Navegação principal"] { display: none !important; }'

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name, exact: true })

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

/** Desktop (light theme only): the viewport and the whole page, sidebar included. */
async function shootDesktop(page: Page, name: string) {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.emulateMedia({ colorScheme: 'light' })
  await page.screenshot({ path: `${OUT}/desktop-${name}-light.png` })
  await page.screenshot({ path: `${OUT}/desktop-${name}-light-full.png`, fullPage: true })
}

// One sign-in for both themes and both sizes: the auth endpoints are rate limited per IP (see support/auth.ts).
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

  await page.getByRole('link', { name: 'Check-in da manhã', exact: true }).click()
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

  await page.getByRole('link', { name: /Questionário de atualização/ }).click()
  await expect(page.getByRole('heading', { name: 'Questionário de atualização' })).toBeVisible()
  await shoot(page, '5b-questionario-modelo')

  // Atualização (update.spec.ts imported the example template, sent a generated photo and marked it as sent).
  await page.getByRole('button', { name: 'Mais' }).click()
  await page.getByRole('dialog', { name: 'Mais' }).getByRole('link', { name: 'Atualização' }).click()
  await expect(page.getByRole('heading', { name: 'Atualização', level: 1 })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Miniatura de Frente' })).toBeVisible()
  await shoot(page, '6-atualizacao-fotos')
  await page.getByRole('tab', { name: /Questionário/ }).click()
  await expect(page.getByRole('heading', { name: 'Dieta de exemplo' })).toBeVisible()
  await shoot(page, '6b-atualizacao-questionario')
  await page.getByRole('tab', { name: /Revisar e enviar/ }).click()
  await expect(page.getByRole('button', { name: 'Copiar texto' })).toBeVisible()
  await shoot(page, '6c-atualizacao-revisar')

  // Desktop: the same session, resized past the lg breakpoint (the sidebar replaces the header and the bottom bar).
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
  const sidebar = page.locator('nav[data-layout="sidebar"]')
  await expect(sidebar).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mais' })).toHaveCount(0)

  await nav(page, 'Hoje').click()
  await expect(page.getByRole('list', { name: 'Itens de hoje' })).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Progresso do dia' })).toBeVisible()
  await shootDesktop(page, '2-hoje')

  await nav(page, 'Resumo').click()
  await expect(page.getByRole('region', { name: 'Ciclo', exact: true })).toBeVisible()
  await shootDesktop(page, '1-resumo')

  await nav(page, 'Planejamento').click()
  await expect(page.getByRole('heading', { name: 'Planejamento' })).toBeVisible()
  await shootDesktop(page, '4-planejamento')

  await page.getByRole('link', { name: 'Ver protocolo' }).click()
  await expect(page).toHaveURL(/\/planejamento\/protocolo$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await shootDesktop(page, '4c-protocolo')

  await nav(page, 'Atualização').click()
  await expect(page.getByRole('heading', { name: 'Atualização', level: 1 })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Miniatura de Frente' })).toBeVisible()
  await shootDesktop(page, '6-atualizacao-fotos')
  await page.getByRole('tab', { name: /Questionário/ }).click()
  await expect(page.getByRole('heading', { name: 'Dieta de exemplo' })).toBeVisible()
  await shootDesktop(page, '6b-atualizacao-questionario')

  await context.close()
})
