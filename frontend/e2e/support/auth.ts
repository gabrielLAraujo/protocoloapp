import { expect, test, type Page } from '@playwright/test'

// The user is created beforehand with `create-user` (CI does it); fictitious credentials.
export const EMAIL = process.env.E2E_EMAIL ?? 'e2e@example.com'
export const PASSWORD = process.env.E2E_PASSWORD ?? 'Senha-e2e-123456'

/** Contexts this worker has signed in so far (each gets its own client IP, see {@link login}). */
let signedInContexts = 0

/** The server's brake on /api/auth/login and /refresh is a fixed window of one minute per IP; never wait longer than this. */
const MAX_RETRY_AFTER_S = 65

/**
 * Signs in through the login screen, as a user does. The auth endpoints allow 5 calls per minute per IP and every spec
 * signs in at least once from the same runner, so a 429 waits for the window (Retry-After, capped) and submits again,
 * once. A shared storageState would not help: the refresh token rotates with reuse detection (two contexts on one token
 * revoke the family) and each fresh page spends a /refresh against the same limit anyway.
 *
 * Each signed-in context also sends its own X-Forwarded-For (the API trusts it, as behind the real proxy, and the limit is
 * per client IP), so the specs no longer queue on one shared bucket of 5 per minute; the 429 wait stays as a fallback.
 */
export async function login(page: Page, email = EMAIL, password = PASSWORD) {
  const n = ++signedInContexts
  await page.context().setExtraHTTPHeaders({ 'X-Forwarded-For': `10.${test.info().workerIndex % 256}.${(n >> 8) % 256}.${n % 256}` })
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(password)

  for (let attempt = 0; ; attempt++) {
    const answered = page.waitForResponse((r) => r.url().includes('/api/auth/login') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'Entrar' }).click()
    const response = await answered
    if (response.status() !== 429 || attempt === 1) {
      expect(response.status(), 'POST /api/auth/login').toBe(200)
      break
    }
    const header = Number(response.headers()['retry-after'])
    const seconds = Math.min(Number.isFinite(header) && header > 0 ? header : 60, MAX_RETRY_AFTER_S) + 1
    // The wait is not the test's own time: give it back.
    test.info().setTimeout(test.info().timeout + seconds * 1000)
    await page.waitForTimeout(seconds * 1000)
  }

  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible()
}
