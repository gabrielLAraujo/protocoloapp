import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { camera } from '../../../platform/camera'
import { Icon } from '../../../ui/Icon'
import { buttonClasses } from '../../../ui/styles'
import { grabFrame, openStream, pickSource, stopStream, type CameraSource, type Facing } from './cameraSource'

const TIMER_SECONDS = 5
const DEFAULT_OPACITY = 35
const UNAVAILABLE = 'Câmera indisponível. Escolha uma foto.'
/** What Tab cycles through inside the dialog (the file input is visually hidden but focusable through its label). */
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'

/** Controls on the black viewfinder: white strokes, a white focus ring (the accent is kept for the shutter). */
const DARK_CONTROL =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-3 text-sm font-semibold text-white select-none ' +
  'transition-colors hover:bg-white/10 active:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-white disabled:opacity-40'

/**
 * Full-screen camera for one pose. In the browser, a live video with the same pose of the previous cycle laid over it
 * (35% by default, adjustable) so the framing repeats; a 5 s timer and front/rear switch. In the APK the native camera
 * opens instead and the previous photo is shown as a reference. With no camera (denied, missing, failed) it falls back
 * to picking a file. The camera tracks stop when it closes or switches.
 */
export function PoseCamera({
  pose,
  overlayUrl,
  onCapture,
  onCancel,
}: {
  pose: { key: string; label: string }
  overlayUrl: string | null
  onCapture(blob: Blob): void
  onCancel(): void
}) {
  const titleId = useId()
  const opacityId = useId()
  const [source, setSource] = useState<CameraSource>(pickSource)
  const [unavailable, setUnavailable] = useState(false)
  const [facing, setFacing] = useState<Facing>('environment')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [opacity, setOpacity] = useState(DEFAULT_OPACITY)
  const [timerOn, setTimerOn] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  const fallBack = () => {
    setSource('file')
    setUnavailable(true)
  }

  useEffect(() => {
    closeButton.current?.focus()
  }, [])

  // One stream per camera; a stream that arrives after the screen closed (or switched) is stopped right away.
  useEffect(() => {
    if (source !== 'media') return
    let active = true
    let opened: MediaStream | null = null
    openStream(facing).then(
      (s) => {
        if (!active) return stopStream(s)
        opened = s
        setStream(s)
      },
      () => {
        if (active) fallBack()
      },
    )
    return () => {
      active = false
      stopStream(opened)
      setStream(null)
      setReady(false)
    }
  }, [source, facing])

  useEffect(() => {
    const el = video.current
    if (!el || !stream) return
    el.srcObject = stream
    try {
      void Promise.resolve(el.play()).catch(() => {})
    } catch {
      // Autoplay refused: the video still shows its first frame once it has one.
    }
  }, [stream])

  const capture = async () => {
    if (!video.current) return
    setError(null)
    try {
      onCapture(await grabFrame(video.current))
    } catch {
      setError('Não foi possível tirar a foto. Tente de novo.')
    }
  }

  const ticker = useRef<ReturnType<typeof setInterval> | null>(null)
  const stopCountdown = () => {
    if (ticker.current !== null) clearInterval(ticker.current)
    ticker.current = null
    setCountdown(null)
  }
  useEffect(() => () => {
    if (ticker.current !== null) clearInterval(ticker.current)
  }, [])

  const startCountdown = () => {
    let left = TIMER_SECONDS
    setCountdown(left)
    ticker.current = setInterval(() => {
      left -= 1
      if (left > 0) return setCountdown(left)
      stopCountdown()
      void capture()
    }, 1000)
  }

  const onShutter = () => {
    if (countdown !== null) return stopCountdown()
    if (timerOn) startCountdown()
    else void capture()
  }

  const openNative = async () => {
    setBusy(true)
    setError(null)
    try {
      const blob = await camera.takePhoto()
      if (blob) onCapture(blob)
    } catch {
      fallBack()
    } finally {
      setBusy(false)
    }
  }

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onCapture(file)
  }

  // Escape closes; Tab and Shift+Tab wrap inside the dialog (aria-modal: the page behind must not take the focus).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onCancel()
      return
    }
    if (e.key !== 'Tab') return
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) return
    const first = items[0]!
    const last = items[items.length - 1]!
    const inside = e.currentTarget.contains(document.activeElement)
    if (e.shiftKey && (document.activeElement === first || !inside)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
      e.preventDefault()
      first.focus()
    }
  }

  const overlayAlt = `Foto anterior de ${pose.label}`
  const mirrored = source === 'media' && facing === 'user'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
    >
      <header className="flex items-center gap-2 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <button ref={closeButton} type="button" onClick={onCancel} className={DARK_CONTROL} aria-label="Fechar">
          <Icon name="cross" />
        </button>
        <div className="min-w-0">
          <h2 id={titleId} className="truncate text-base font-semibold">
            {pose.label}
          </h2>
          {overlayUrl && source === 'media' && <p className="text-xs text-white/70">Alinhe o corpo com a foto anterior.</p>}
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {source === 'media' ? (
          <div className="absolute inset-0" style={mirrored ? { transform: 'scaleX(-1)' } : undefined}>
            <video
              ref={video}
              muted
              playsInline
              autoPlay
              onLoadedMetadata={() => setReady(true)}
              className="h-full w-full object-contain"
            />
            {overlayUrl && (
              <img
                src={overlayUrl}
                alt={overlayAlt}
                className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                style={{ opacity: opacity / 100 }}
              />
            )}
          </div>
        ) : overlayUrl ? (
          <figure className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
            <img src={overlayUrl} alt={overlayAlt} className="min-h-0 max-w-full flex-1 rounded-card object-contain" />
            <figcaption className="text-sm text-white/70">Foto anterior: repita a posição e o enquadramento.</figcaption>
          </figure>
        ) : (
          <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/70">
            Sem foto anterior desta pose.
          </p>
        )}

        {countdown !== null && (
          <div
            role="status"
            aria-live="assertive"
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-[8rem] leading-none font-semibold tabular-nums [text-shadow:0_2px_24px_rgb(0_0_0/0.6)]"
          >
            {countdown}
          </div>
        )}
      </div>

      <footer className="flex flex-col gap-3 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {(error || unavailable) && (
          <p role="alert" className="text-center text-sm text-white">
            {error ?? UNAVAILABLE}
          </p>
        )}

        {source === 'media' && overlayUrl && (
          <div className="flex items-center gap-3 text-sm">
            <label htmlFor={opacityId} className="w-20 shrink-0 text-white/80">
              Opacidade
            </label>
            <input
              id={opacityId}
              type="range"
              min={0}
              max={100}
              step={5}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              aria-valuetext={`${opacity}%`}
              className="min-h-11 flex-1 accent-white"
            />
            <span className="w-10 shrink-0 text-right tabular-nums text-white/80">{opacity}%</span>
          </div>
        )}

        {source === 'media' && (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <button
              type="button"
              aria-label={`Temporizador ${TIMER_SECONDS} s`}
              aria-pressed={timerOn}
              disabled={countdown !== null}
              onClick={() => setTimerOn((on) => !on)}
              className={`${DARK_CONTROL} justify-self-start ${timerOn ? 'bg-white text-black hover:bg-white active:bg-white' : ''}`}
            >
              <Icon name="timer" />
              {TIMER_SECONDS} s
            </button>
            <button
              type="button"
              aria-label={countdown !== null ? 'Cancelar temporizador' : 'Tirar foto'}
              disabled={!ready}
              onClick={onShutter}
              className="flex size-18 items-center justify-center rounded-full border-4 border-white transition-transform select-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white active:scale-95 disabled:opacity-40 motion-reduce:transition-none"
            >
              {countdown !== null ? <Icon name="cross" size={28} /> : <span className="size-14 rounded-full bg-accent" />}
            </button>
            <button
              type="button"
              disabled={countdown !== null}
              onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
              className={`${DARK_CONTROL} justify-self-end`}
            >
              <Icon name="swap" />
              Trocar câmera
            </button>
          </div>
        )}

        {source === 'native' && (
          <button
            type="button"
            onClick={() => void openNative()}
            disabled={busy}
            className={buttonClasses({ variant: 'primary', size: 'lg', block: true })}
          >
            Abrir câmera
          </button>
        )}

        {source === 'file' && (
          <label className={`${buttonClasses({ variant: 'primary', size: 'lg', block: true })} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-white`}>
            Escolher foto
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={onFile} className="sr-only" />
          </label>
        )}
      </footer>
    </div>
  )
}
