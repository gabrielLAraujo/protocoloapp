import { Camera, CameraErrorCode, EncodingType } from '@capacitor/camera'
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

  /**
   * Opens the native camera (APK) for one JPEG photo. Resolves `null` when the person closes the camera without taking
   * one; rejects on any other failure (no camera, permission denied), so the caller can fall back to a file.
   */
  async takePhoto(): Promise<Blob | null> {
    try {
      const result = await Camera.takePhoto({ quality: 90, encodingType: EncodingType.JPEG, correctOrientation: true })
      if (!result.webPath) throw new Error('no_photo_path')
      const response = await fetch(result.webPath)
      return await response.blob()
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === CameraErrorCode.TakePhotoCancelled) return null
      throw error
    }
  },
}
