import { Capacitor } from '@capacitor/core'
import { api } from '../api/client'
import type { components } from '../api/schema'

export type LatestRelease = components['schemas']['LatestReleaseResponse']

/** The version this build was made from ("0.1.12"); CI sets it for the APK, local builds are "dev". */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? 'dev'

const parse = (version: string): number[] | null => {
  const clean = version.trim().replace(/^v/i, '')
  return /^\d+(\.\d+)*$/.test(clean) ? clean.split('.').map(Number) : null
}

/** True when `candidate` is a higher dotted-number version than `current`. Anything that is not a version ("dev") is never newer. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parse(candidate)
  const b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

/**
 * The release to offer when a newer one than `current` is published, otherwise null. Only the installed app checks (the web
 * build is always the latest), and any failure (offline, server or GitHub down, no release yet) is just "no update".
 */
export async function checkForUpdate(current: string): Promise<LatestRelease | null> {
  if (!Capacitor.isNativePlatform() || !parse(current)) return null
  try {
    const { data } = await api.GET('/api/app/latest-release')
    return data && isNewerVersion(data.version, current) ? data : null
  } catch {
    return null
  }
}

/**
 * Downloads the APK through the API (it needs the login; the repository is private) and hands the file to the system, which
 * offers to install it. Throws when the download fails.
 */
export async function downloadApk(release: LatestRelease): Promise<void> {
  const { data, response } = await api.GET('/api/app/apk', { parseAs: 'blob' })
  if (!response.ok || !data) throw new Error(`APK download failed (${response.status})`)

  const url = URL.createObjectURL(data as unknown as Blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `protocolo-${release.version}.apk`
  document.body.append(link)
  link.click()
  link.remove()
  // Long enough for the system downloader to read it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
