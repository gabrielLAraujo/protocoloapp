import { expect, test, type Page, type Response } from '@playwright/test'
import { login } from './support/auth.ts'

// Runs after the `chromium` project (playwright.config.ts, project `today`): workout.spec.ts imported and activated the
// fictitious protocol through the Anthropic stub, so today has the meal "Refeicao 1" (e2e/fixtures/anthropic-stub.mjs).
// Assumes the fresh database CI starts per run: nothing has marked that meal yet. No time-of-day dependence: Resumo
// counts today's targets that are marked even before their time, so marking the meal makes Dieta > 0%. The protocol's
// cycle starts yesterday (workout.spec.ts), so Hoje can go back one day.
const MEAL = 'Refeicao 1'

const isPush = (response: Response) => response.url().includes('/api/sync/push') && response.request().method() === 'POST'

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name, exact: true })

/** "1,5 de 4 L" → 1.5. */
const litersOf = (text: string | null) => Number((text ?? '').trim().split(' ')[0]!.replace(',', '.'))
const formatLiters = (liters: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(liters)

/** Waits for the header to say "Sincronizado" with nothing pending (the label only shows after a complete, successful run). */
async function expectSynced(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Sincronizado$/ })).toBeVisible()
  await expect(page.locator('header').getByText(/pendente/)).toHaveCount(0)
}

test('marks a meal on Hoje offline, syncs it, adds water and sees the diet rate in the summary', async ({ browser }) => {
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

  // Água: "+500 ml" adds half a liter to the day's total. Relative to what is there (earlier specs may have saved an
  // evening check-in today, or not): water alone is a valid evening part, so the push is applied either way.
  const water = page.getByRole('region', { name: 'Água' })
  const total = water.locator('[data-water-total]')
  await expect(total).toHaveText(/\d L$/)
  const before = litersOf(await total.textContent())
  await water.getByRole('button', { name: 'Adicionar 500 ml de água' }).click()
  await expect(total).toHaveText(new RegExp(`^${formatLiters(before + 0.5)} (de |L)`))
  await expectSynced(page)

  // Desvio: something eaten outside the plan in the meal, from its "⋯" sheet; the row shows the "Desvio" chip. The diet
  // rate stays positive (1 done of 1 meal + 1 deviation).
  await page.getByRole('button', { name: `Mais opções para ${MEAL}` }).click()
  await page.getByRole('dialog', { name: MEAL }).getByRole('button', { name: 'Comi algo fora do plano' }).click()
  const deviation = page.getByRole('dialog', { name: 'Comi algo fora do plano' })
  await deviation.getByLabel('O que foi').fill('Biscoito')
  await deviation.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByRole('listitem', { name: MEAL }).getByText('Desvio', { exact: true })).toBeVisible()
  await expectSynced(page)

  // Resumo: the cycle started yesterday, so the meal marked today makes the diet rate positive.
  await nav(page, 'Resumo').click()
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible()
  // The figure is the first <dd> of the term; the caption is a second one.
  const diet = page.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Dieta$/ }) }).locator('dd').first()
  await expect(diet).toHaveText(/^\d+%$/)
  await expect(diet).not.toHaveText(/^(0%|—)$/)

  await context.close()
})

/** "19/10" for the São Paulo calendar day `offset` days from today, and its yyyy-MM-dd. */
function saoPauloDay(offset: number): { iso: string; short: string } {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  const iso = new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10)
  const [, m, d] = iso.split('-')
  return { iso, short: `${d}/${m}` }
}

test("fixes yesterday: marks yesterday's meal and logs a workout for yesterday", async ({ page }) => {
  const yesterday = saoPauloDay(-1)

  await login(page)
  await expectSynced(page)

  // Hoje, one day back: the meal is marked on yesterday's date.
  await nav(page, 'Hoje').click()
  await expect(page.getByRole('heading', { name: 'Hoje' })).toBeVisible()
  await page.getByRole('button', { name: 'Dia anterior', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/hoje\\?dia=${yesterday.iso}$`))
  await expect(page.getByRole('heading', { name: new RegExp(`Dia ${yesterday.short}`) })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Próxima tarefa' })).toHaveCount(0)
  const done = page.getByRole('group', { name: `Marcar ${MEAL}` }).getByRole('button', { name: 'Feito' })
  await expect(done).toHaveAttribute('aria-pressed', 'false')
  await done.click()
  await expect(done).toHaveAttribute('aria-pressed', 'true')
  await expectSynced(page)
  // Back on today, the meal there is not marked by it.
  await page.getByRole('button', { name: 'Dia seguinte', exact: true }).click()
  await expect(page).toHaveURL(/\/hoje$/)
  await expect(page.getByRole('heading', { name: 'Hoje' })).toBeVisible()

  // Treino: a workout forgotten yesterday, logged without the rest timer and saved finished on that day.
  await nav(page, 'Treino').click()
  await page.getByRole('button', { name: 'Registrar treino de outro dia' }).click()
  const form = page.getByRole('region', { name: 'Registrar treino de outro dia' })
  await expect(form.getByLabel('Data do treino')).toHaveValue(yesterday.iso)
  await form.getByRole('button', { name: /Treino A - Exemplo/ }).click()
  await expect(page.getByText(`Registro do treino de ${yesterday.short}`)).toBeVisible()
  const card = page.getByRole('region', { name: 'Exercicio Ficticio Alfa' })
  await card.getByLabel('Carga da série 1 (kg)').fill('55')
  await card.getByLabel('Repetições da série 1').fill('10')
  await card.getByRole('button', { name: 'Concluir série 1' }).click()
  await expect(card.getByRole('button', { name: 'Editar série 1' })).toBeVisible()
  await expect(page.getByText(/^Descanso \d/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Salvar treino' }).click()
  await expect(page.getByText(`Treino de ${yesterday.short} salvo`)).toBeVisible()
  await expectSynced(page)

  // Histórico lists it on yesterday's date.
  await page.getByRole('link', { name: 'Histórico de treinos' }).click()
  const [y, m, d] = yesterday.iso.split('-')
  await expect(page.getByRole('region', { name: 'Sessões' }).getByText(`${d}/${m}/${y}`)).toBeVisible()
})
