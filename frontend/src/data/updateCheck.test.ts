import { Capacitor } from '@capacitor/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { json, mockFetch, problem } from '../test/fetch-mock'
import { checkForUpdate, isNewerVersion } from './updateCheck'

const release = { version: '0.1.13', apkUrl: 'https://protocolo.example.test/api/app/apk' }

beforeEach(() => {
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
})

describe('isNewerVersion', () => {
  it.each([
    ['0.1.13', '0.1.12', true],
    ['0.1.12', '0.1.12', false],
    ['0.1.11', '0.1.12', false],
    ['0.1.10', '0.1.9', true], // numeric, not alphabetical
    ['0.2.0', '0.1.99', true],
    ['1.0', '0.9.9', true],
    ['v0.1.13', '0.1.12', true],
    ['0.1.13', 'dev', false],
    ['garbage', '0.1.12', false],
  ])('%s vs %s -> %s', (candidate, current, expected) => {
    expect(isNewerVersion(candidate, current)).toBe(expected)
  })
})

describe('checkForUpdate', () => {
  it('returns null when the latest release is the installed version', async () => {
    mockFetch({ 'GET /api/app/latest-release': () => json({ ...release, version: '0.1.12' }) })

    expect(await checkForUpdate('0.1.12')).toBeNull()
  })

  it('returns the release when it is newer', async () => {
    mockFetch({ 'GET /api/app/latest-release': () => json(release) })

    expect(await checkForUpdate('0.1.12')).toEqual(release)
  })

  it('returns null when the installed version is newer than the release', async () => {
    mockFetch({ 'GET /api/app/latest-release': () => json(release) })

    expect(await checkForUpdate('0.1.20')).toBeNull()
  })

  it('does not ask the server in the browser', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false)
    const calls = mockFetch({})

    expect(await checkForUpdate('0.1.12')).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('does not ask the server for a development build', async () => {
    const calls = mockFetch({})

    expect(await checkForUpdate('dev')).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('returns null when the server cannot tell (503)', async () => {
    mockFetch({ 'GET /api/app/latest-release': () => problem(503) })

    expect(await checkForUpdate('0.1.12')).toBeNull()
  })

  it('returns null when offline', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))

    expect(await checkForUpdate('0.1.12')).toBeNull()
  })
})
