import { Capacitor } from '@capacitor/core'

/** Where a pose photo comes from: the live browser camera, the native camera of the APK, or a picked file. */
export type CameraSource = 'media' | 'native' | 'file'

/** Front (selfie) or rear camera. */
export type Facing = 'user' | 'environment'

export function pickSource(): CameraSource {
  if (Capacitor.isNativePlatform()) return 'native'
  if (typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function') return 'media'
  return 'file'
}

/** Asks for a video stream from one camera; no audio. Rejects when permission is denied or there is no camera. */
export function openStream(facing: Facing): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1920 } },
  })
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop())
}

/** The current frame of a playing video as a JPEG, at the camera's own resolution (never mirrored). */
export function grabFrame(video: HTMLVideoElement, quality = 0.92): Promise<Blob> {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) return Promise.reject(new Error('camera_not_ready'))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('canvas_unavailable'))
  ctx.drawImage(video, 0, 0, width, height)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode_failed'))), 'image/jpeg', quality)
  })
}
