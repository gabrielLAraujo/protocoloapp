import { readFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'
import { login } from './support/auth.ts'

// Runs after the `chromium` project (playwright.config.ts, project `today`): workout.spec.ts activated the fictitious
// protocol, whose update date is 30 days out, so the server has opened its update cycle. Everything here is fictitious:
// the template is the repository's example (fixtures/questionnaire-template.example.json, invented questions) and the
// photo is a solid rectangle encoded in memory below, never written to disk.
const TEMPLATE = new URL('../../fixtures/questionnaire-template.example.json', import.meta.url)
const CALCULATED_QUESTION = 'Quantos treinos de exemplo foram perdidos?'
const CHOICE_QUESTION = 'Como foi a fome na semana de exemplo?'
const NUMBER_QUESTION = 'De 0 a 10, que nota você dá ao treino de exemplo?'

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name, exact: true })

/**
 * Waits for "Sincronizado" with nothing pending. A save made during a sync run goes out in the follow-up run the engine
 * schedules; "Sincronizar agora" stays as a harmless nudge, as a user would press it.
 */
async function expectSynced(page: Page) {
  const synced = page.getByRole('status').filter({ hasText: /^Sincronizado$/ })
  await expect(async () => {
    if (!(await synced.isVisible())) await page.getByRole('button', { name: 'Sincronizar agora' }).click({ timeout: 2_000 })
    await expect(synced).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
  await expect(page.getByText(/pendente/)).toHaveCount(0)
}

/** A PNG of one flat color (RGB, 8 bits), built with zlib: a generated image, never a real photo. */
function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8) // bit depth 8, truecolor, deflate, no filter, no interlace
  const row = Buffer.alloc(1 + width * 3) // filter byte 0, then the pixels
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3)
  const pixels = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

test('imports the example questionnaire, answers it, sends a photo, copies the text and marks the update as sent', async ({ browser }) => {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  // No camera on the runner, and a denied permission must not depend on the browser build: the camera falls back to
  // picking a file, as on a device without one.
  // (Strings: the e2e is type-checked without the DOM library.)
  await context.addInitScript(
    "if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('No camera in the e2e', 'NotAllowedError'))",
  )
  const page = await context.newPage()

  await login(page)
  await expectSynced(page)

  // Configurações → Questionário de atualização → Importar JSON (the example file of the repository).
  await nav(page, 'Configurações').click()
  await page.getByRole('link', { name: /Questionário de atualização/ }).click()
  await expect(page.getByRole('heading', { name: 'Questionário de atualização' })).toBeVisible()
  await page.locator('input[type="file"][accept*="json"]').setInputFiles({
    name: 'questionario-modelo.json',
    mimeType: 'application/json',
    buffer: readFileSync(TEMPLATE),
  })
  // A local rerun against the same database already has a template: replace it with the same one.
  const replace = page.getByRole('dialog', { name: 'Substituir o modelo atual?' })
  const imported = page.getByRole('status').filter({ hasText: 'Modelo importado.' })
  await expect(imported.or(replace)).toBeVisible()
  if (await replace.isVisible()) await replace.getByRole('button', { name: 'Substituir' }).click()
  await expect(imported).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dieta de exemplo' })).toBeVisible()
  await expectSynced(page)

  // Atualização, from the menu.
  await nav(page, 'Atualização').click()
  await expect(page).toHaveURL(/\/atualizacao$/)
  await expect(page.getByRole('heading', { name: 'Atualização', level: 1 })).toBeVisible()

  // Fotos: "Frente" through the file fallback; the thumbnail shows once the storage stub has it and the API confirmed it.
  const front = page.getByRole('listitem', { name: 'Frente' })
  await front.getByRole('button', { name: /Tirar foto|Refazer/ }).click()
  const camera = page.getByRole('dialog', { name: 'Frente' })
  await expect(camera.getByRole('alert')).toHaveText('Câmera indisponível. Escolha uma foto.')
  await camera.locator('input[type="file"]').setInputFiles({ name: 'frente.png', mimeType: 'image/png', buffer: solidPng(120, 160, [64, 128, 192]) })
  await expect(camera).toHaveCount(0)
  await expect(front.getByRole('img', { name: 'Miniatura de Frente' })).toBeVisible()
  await expect(front.getByText('Enviada', { exact: true })).toBeVisible()
  await expectSynced(page)

  // Questionário: a calculated answer (metrics from the server) and two subjective ones.
  await page.getByRole('tab', { name: /Questionário/ }).click()
  const calculated = page.getByRole('textbox', { name: CALCULATED_QUESTION })
  await expect(calculated).not.toHaveValue('')
  await expect(page.getByText('Calculado', { exact: true }).first()).toBeVisible()
  await page.getByRole('radiogroup', { name: CHOICE_QUESTION }).getByText('Normal', { exact: true }).click()
  await page.getByRole('textbox', { name: NUMBER_QUESTION }).fill('8')

  // Revisar e enviar: the answers as they go, the text in the clipboard, then "Marcar como enviada".
  await page.getByRole('tab', { name: /Revisar e enviar/ }).click()
  await expect(page.getByRole('definition').filter({ hasText: /^8$/ })).toBeVisible()
  await page.getByRole('button', { name: 'Copiar texto' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Texto copiado' })).toBeVisible()
  const text = String(await page.evaluate('navigator.clipboard.readText()'))
  expect(text).toContain('Questionário de exemplo')
  expect(text).toContain(`${CHOICE_QUESTION}\nNormal`)
  expect(text).toContain(`${NUMBER_QUESTION}\n8`)
  expect(text).toContain(CALCULATED_QUESTION)

  await page.getByRole('button', { name: 'Marcar como enviada' }).click()
  await expect(page.getByText(/^Enviada em \d{2}\/\d{2}$/)).toBeVisible()
  await expectSynced(page)

  // After a reload (the device's data is read again and synced): still sent, the photo and the answers kept.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Atualização', level: 1 })).toBeVisible()
  await expect(page.getByText(/^Enviada em \d{2}\/\d{2}$/)).toBeVisible()
  await expect(page.getByRole('listitem', { name: 'Frente' }).getByRole('img', { name: 'Miniatura de Frente' })).toBeVisible()
  await page.getByRole('tab', { name: /Revisar e enviar/ }).click()
  await expect(page.getByRole('definition').filter({ hasText: /^Normal$/ })).toBeVisible()

  await context.close()
})
