import { expect, test, type Page, type Response } from '@playwright/test'
import { login } from './support/auth.ts'

// Runs after the `chromium` project (playwright.config.ts, project `today`): workout.spec.ts imported and activated the
// fictitious protocol through the Anthropic stub, so today has the meal "Refeicao 1" (e2e/fixtures/anthropic-stub.mjs).
// Assumes the fresh database CI starts per run: nothing has marked that meal yet. No time-of-day dependence: Resumo
// counts today's targets that are marked even before their time, so marking the meal makes Dieta > 0%.
const MEAL = 'Refeicao 1'

const isPush = (response: Response) => response.url().includes('/api/sync/push') && response.request().method() === 'POST'

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name })

/** Waits for the header to say "Sincronizado" with nothing pending (the label only shows after a complete, successful run). */
async function expectSynced(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Sincronizado$/ })).toBeVisible()
  await expect(page.locator('header').getByText(/pendente/)).toHaveCount(0)
}

test('marks a meal on Hoje offline, syncs it and sees the diet rate in the summary', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  await login(page)
  await expectSynced(page)

  await nav(page, 'Hoje').click()
  await expect(page).toHaveURL(/\/hoje$/)
  await expect(page.getByRole('heading', { name: 'Hoje' })).toBeVisible()
  const marks = page.getByRole('group', { name: `Marcar ${MEAL}` })
  const done = marks.getByRole('button', { name: 'Feito' })
  await expect(done).toHaveAttribute('aria-pressed', 'false')
  // Opening Hoje may create the default reminder times and sync them: let that finish before the network goes.
  await expectSynced(page)

  // Offline: the mark is saved on the device only.
  await context.setOffline(true)
  await done.click()
  await expect(done).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Offline — 1 pendente')).toBeVisible()

  // Back online: the mark is pushed (the 'online' event may already start the run).
  const pushed = page.waitForResponse(isPush)
  await context.setOffline(false)
  await page.getByRole('button', { name: 'Sincronizar agora' }).click()
  expect((await pushed).status()).toBe(200)
  await expectSynced(page)

  // Resumo: the cycle started today (activation), so the marked meal makes the diet rate positive.
  await nav(page, 'Resumo').click()
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible()
  const diet = page.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Dieta$/ }) }).locator('dd')
  await expect(diet).toHaveText(/^\d+%$/)
  await expect(diet).not.toHaveText(/^(0%|—)$/)

  await context.close()
})
