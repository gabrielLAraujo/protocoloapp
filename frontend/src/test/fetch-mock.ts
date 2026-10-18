import { vi } from 'vitest'

/** A request that reached the fake `fetch`, in the order it was made. */
export type Call = {
  method: string
  /** Path + query, without the origin. */
  path: string
  headers: Headers
  body: string
}

export type Handler = (call: Call) => Response | Promise<Response>

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export const problem = (status: number, body: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ status, ...body }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  })

/**
 * Replaces the global `fetch` with a fake server. Routes are "METHOD /path" (no query). A request without a route is a
 * test error: it fails loudly instead of answering a silent 404.
 */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: Call[] = []

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    const call: Call = {
      method: request.method,
      path: url.pathname + url.search,
      headers: request.headers,
      body: await request.clone().text(),
    }
    calls.push(call)

    const handler = routes[`${request.method} ${url.pathname}`]
    if (!handler) throw new Error(`Request without a route in the fake fetch: ${request.method} ${url.pathname}`)
    return handler(call)
  })

  return calls
}

/** A token response as the API returns it. Fictitious values. */
export const tokenResponse = (suffix = '1') => ({
  accessToken: `access-${suffix}`,
  accessTokenExpiresAt: '2026-10-18T12:15:00+00:00',
  refreshToken: `refresh-${suffix}`,
})
