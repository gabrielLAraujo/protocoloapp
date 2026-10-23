import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ value: false }))
const takePhoto = vi.hoisted(() => vi.fn())

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.value } }))
vi.mock('@capacitor/camera', () => ({
  Camera: { takePhoto, checkPermissions: vi.fn(), requestPermissions: vi.fn() },
  CameraErrorCode: { TakePhotoCancelled: 'OS-PLUG-CAMR-0006' },
  EncodingType: { JPEG: 0, PNG: 1 },
}))

import { PoseCamera } from './PoseCamera'
import { pickSource } from './cameraSource'

const POSE = { key: 'front', label: 'Frente' }
// A generated image: a few bytes of a colored rectangle, never a real photo.
const OVERLAY = 'data:image/png;base64,iVBORw0KGgo='

function fakeStream() {
  const track = { stop: vi.fn(), kind: 'video' }
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track }
}

function stubMedia(getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>) {
  const spy = vi.fn(getUserMedia)
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: spy } })
  return spy
}

function facingOf(call: [MediaStreamConstraints]): unknown {
  return ((call[0].video as MediaTrackConstraints).facingMode as { ideal: string }).ideal
}

/** Pretends the video got its first frame (jsdom has no media pipeline) and that canvas encoding works. */
function videoReady() {
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(640)
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(853)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
    cb(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }))
  })
  fireEvent(document.querySelector('video')!, new Event('loadedmetadata'))
}

beforeEach(() => {
  native.value = false
  takePhoto.mockReset()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('pickSource', () => {
  it('prefers the native camera in the APK, then getUserMedia, then a file', () => {
    native.value = true
    expect(pickSource()).toBe('native')
    native.value = false
    stubMedia(() => Promise.resolve(fakeStream().stream))
    expect(pickSource()).toBe('media')
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: undefined })
    expect(pickSource()).toBe('file')
  })
})

describe('PoseCamera (browser camera)', () => {
  it('shows the live video with the previous photo over it at 35%', async () => {
    const { stream } = fakeStream()
    const gum = stubMedia(() => Promise.resolve(stream))
    render(<PoseCamera pose={POSE} overlayUrl={OVERLAY} onCapture={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: 'Frente' })).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('video')?.srcObject).toBe(stream))
    expect(facingOf(gum.mock.calls[0])).toBe('environment')
    const overlay = screen.getByAltText('Foto anterior de Frente')
    expect(overlay).toHaveStyle({ opacity: '0.35' })

    fireEvent.change(screen.getByLabelText('Opacidade'), { target: { value: '80' } })
    expect(overlay).toHaveStyle({ opacity: '0.8' })
  })

  it('takes the current frame as a JPEG', async () => {
    stubMedia(() => Promise.resolve(fakeStream().stream))
    const onCapture = vi.fn()
    render(<PoseCamera pose={POSE} overlayUrl={null} onCapture={onCapture} onCancel={vi.fn()} />)
    await waitFor(() => expect(document.querySelector('video')?.srcObject).toBeTruthy())
    videoReady()

    await userEvent.click(screen.getByRole('button', { name: 'Tirar foto' }))
    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1))
    expect((onCapture.mock.calls[0][0] as Blob).type).toBe('image/jpeg')
    expect(screen.queryByLabelText('Opacidade')).not.toBeInTheDocument()
  })

  it('with the 5 s timer, counts down and takes the photo after 5 seconds', async () => {
    vi.useFakeTimers()
    stubMedia(() => Promise.resolve(fakeStream().stream))
    const onCapture = vi.fn()
    render(<PoseCamera pose={POSE} overlayUrl={null} onCapture={onCapture} onCancel={vi.fn()} />)
    await act(async () => {})
    videoReady()

    fireEvent.click(screen.getByRole('button', { name: 'Temporizador 5 s' }))
    expect(screen.getByRole('button', { name: 'Temporizador 5 s' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Tirar foto' }))
    expect(screen.getByRole('status')).toHaveTextContent('5')

    for (let i = 0; i < 4; i++) await act(async () => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('status')).toHaveTextContent('1')
    expect(onCapture).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTime(1000))
    expect(onCapture).toHaveBeenCalledTimes(1)
  })

  it('switching the camera stops the old tracks and asks for the other facingMode', async () => {
    const first = fakeStream()
    const second = fakeStream()
    const gum = stubMedia(vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream))
    render(<PoseCamera pose={POSE} overlayUrl={null} onCapture={vi.fn()} onCancel={vi.fn()} />)
    await waitFor(() => expect(document.querySelector('video')?.srcObject).toBe(first.stream))

    await userEvent.click(screen.getByRole('button', { name: 'Trocar câmera' }))
    await waitFor(() => expect(document.querySelector('video')?.srcObject).toBe(second.stream))
    expect(first.track.stop).toHaveBeenCalled()
    expect(facingOf(gum.mock.calls[1])).toBe('user')
  })

  it('stops the tracks when it closes', async () => {
    const { stream, track } = fakeStream()
    stubMedia(() => Promise.resolve(stream))
    const view = render(<PoseCamera pose={POSE} overlayUrl={null} onCapture={vi.fn()} onCancel={vi.fn()} />)
    await waitFor(() => expect(document.querySelector('video')?.srcObject).toBe(stream))
    view.unmount()
    expect(track.stop).toHaveBeenCalled()
  })

  it('stops a stream that arrives after it closed', async () => {
    const { stream, track } = fakeStream()
    let resolve!: (s: MediaStream) => void
    stubMedia(() => new Promise((r) => (resolve = r)))
    const view = render(<PoseCamera pose={POSE} overlayUrl={null} onCapture={vi.fn()} onCancel={vi.fn()} />)
    view.unmount()
    await act(async () => resolve(stream))
    expect(track.stop).toHaveBeenCalled()
  })

  it('Escape and "Fechar" call onCancel', async () => {
    stubMedia(() => Promise.resolve(fakeStream().stream))
    const onCancel = vi.fn()
    render(<PoseCamera pose={POSE} overlayUrl={null} onCapture={vi.fn()} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})

describe('PoseCamera (fallback to a file)', () => {
  it('falls back to a file when getUserMedia is rejected, and a chosen file is captured', async () => {
    stubMedia(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
    const onCapture = vi.fn()
    render(<PoseCamera pose={POSE} overlayUrl={OVERLAY} onCapture={onCapture} onCancel={vi.fn()} />)

    expect(await screen.findByText('Câmera indisponível. Escolha uma foto.')).toBeInTheDocument()
    expect(document.querySelector('video')).not.toBeInTheDocument()
    expect(screen.getByAltText('Foto anterior de Frente')).toBeInTheDocument()

    const input = screen.getByLabelText('Escolher foto') as HTMLInputElement
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
    expect(input).toHaveAttribute('capture', 'environment')
    const file = new File([new Uint8Array([1, 2, 3])], 'generated.jpg', { type: 'image/jpeg' })
    await userEvent.upload(input, file)
    expect(onCapture).toHaveBeenCalledWith(file)
  })

  it('without getUserMedia goes straight to the file', () => {
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: undefined })
    render(<PoseCamera pose={POSE} overlayUrl={null} onCapture={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('Escolher foto')).toBeInTheDocument()
    expect(screen.queryByText('Câmera indisponível. Escolha uma foto.')).not.toBeInTheDocument()
  })
})

describe('PoseCamera focus', () => {
  it('Tab and Shift+Tab stay inside the dialog', async () => {
    stubMedia(() => Promise.reject(new Error('denied')))
    const outside = document.createElement('button')
    outside.textContent = 'Fora'
    document.body.append(outside)
    const user = userEvent.setup()
    render(<PoseCamera pose={POSE} overlayUrl={null} onCapture={vi.fn()} onCancel={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Frente' })
    const close = screen.getByRole('button', { name: 'Fechar' })
    await screen.findByLabelText('Escolher foto')
    expect(close).toHaveFocus()

    await user.tab({ shift: true })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(document.activeElement).not.toBe(close)
    for (let i = 0; i < 5; i++) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    expect(outside).not.toHaveFocus()
    outside.remove()
  })
})

describe('PoseCamera (APK)', () => {
  beforeEach(() => {
    native.value = true
  })

  it('shows the previous photo as a reference and opens the native camera', async () => {
    const blob = new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' })
    takePhoto.mockResolvedValue({ webPath: 'blob:generated' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: () => Promise.resolve(blob) }))
    const onCapture = vi.fn()
    render(<PoseCamera pose={POSE} overlayUrl={OVERLAY} onCapture={onCapture} onCancel={vi.fn()} />)

    expect(document.querySelector('video')).not.toBeInTheDocument()
    expect(screen.getByAltText('Foto anterior de Frente')).not.toHaveStyle({ opacity: '0.35' })
    await userEvent.click(screen.getByRole('button', { name: 'Abrir câmera' }))
    await waitFor(() => expect(onCapture).toHaveBeenCalledWith(blob))
    // Never a full-size copy in the gallery.
    expect(takePhoto).toHaveBeenCalledWith(expect.objectContaining({ saveToGallery: false }))
  })

  it('a cancelled native camera keeps the screen; a failure falls back to a file', async () => {
    takePhoto.mockRejectedValueOnce({ code: 'OS-PLUG-CAMR-0006' }).mockRejectedValueOnce(new Error('no camera'))
    const onCapture = vi.fn()
    render(<PoseCamera pose={POSE} overlayUrl={null} onCapture={onCapture} onCancel={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Abrir câmera' }))
    await waitFor(() => expect(takePhoto).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Abrir câmera' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Abrir câmera' }))
    expect(await screen.findByText('Câmera indisponível. Escolha uma foto.')).toBeInTheDocument()
    expect(screen.getByLabelText('Escolher foto')).toBeInTheDocument()
    expect(onCapture).not.toHaveBeenCalled()
  })
})
