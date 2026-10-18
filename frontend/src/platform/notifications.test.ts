import { describe, expect, it } from 'vitest'
import { camera } from './camera'
import { notifications } from './notifications'

describe('web fallback', () => {
  it('notifications report granted and sendTest is a no-op', async () => {
    expect(await notifications.ensurePermission()).toBe('granted')
    await expect(notifications.sendTest()).resolves.toBeUndefined()
  })

  it('camera reports granted', async () => {
    expect(await camera.ensurePermission()).toBe('granted')
  })
})
