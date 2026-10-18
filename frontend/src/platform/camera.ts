import { Camera } from '@capacitor/camera'
import { Capacitor } from '@capacitor/core'
import type { PermissionResult } from './notifications'

/** Camera permission. The browser asks for it when a picture is actually taken, so the web build reports "granted". */
export const camera = {
  async ensurePermission(): Promise<PermissionResult> {
    if (!Capacitor.isNativePlatform()) return 'granted'
    let { camera: state } = await Camera.checkPermissions()
    if (state === 'prompt' || state === 'prompt-with-rationale') {
      state = (await Camera.requestPermissions({ permissions: ['camera'] })).camera
    }
    return state === 'granted' ? 'granted' : 'denied'
  },
}
