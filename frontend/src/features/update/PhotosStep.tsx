import { useId, useState } from 'react'
import type { PhotoThumbLocal } from '../../data/photoThumbRepo'
import type { UpdateCycleLocal } from '../../data/updateCycleRepo'
import type { Pose } from '../../domain/questionnaireTemplate'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { Icon } from '../../ui/Icon'
import { cardClasses } from '../../ui/styles'
import { PoseCamera } from './camera/PoseCamera'

type PoseState = 'sent' | 'pending' | 'missing'

const STATE_CHIP: Record<PoseState, { text: string; tone: 'ok' | 'neutral' | 'warn' }> = {
  sent: { text: 'Enviada', tone: 'ok' },
  pending: { text: 'Pendente de envio', tone: 'warn' },
  missing: { text: 'Falta', tone: 'neutral' },
}

function PoseTile({ pose, state, thumb, onTake }: { pose: Pose; state: PoseState; thumb: string | null; onTake(): void }) {
  const labelId = useId()
  const chip = STATE_CHIP[state]
  return (
    <li aria-labelledby={labelId} className={cardClasses({ padding: 'none', className: 'grid overflow-hidden' })}>
      <div className="relative aspect-[3/4] border-b border-line bg-raised">
        {thumb ? (
          <img src={thumb} alt={`Miniatura de ${pose.label}`} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-muted/70">
            <Icon name={state === 'pending' ? 'upload' : 'camera'} size={28} strokeWidth={1.6} />
          </span>
        )}
      </div>
      <div className="grid gap-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <h3 id={labelId} className="text-sm font-semibold">
            {pose.label}
          </h3>
          <Chip tone={chip.tone} className="whitespace-normal!">
            {chip.text}
          </Chip>
        </div>
        <Button size="sm" variant={state === 'missing' ? 'primary' : 'secondary'} icon="camera" block onClick={onTake}>
          {state === 'missing' ? 'Tirar foto' : 'Refazer'}
        </Button>
      </div>
    </li>
  )
}

/**
 * Fotos: one tile per pose of the template, with the thumbnail once sent, "Pendente de envio" while it waits in the
 * queue, and the camera with the same pose of the previous cycle laid over it.
 */
export function PhotosStep({
  cycle,
  poses,
  thumbs,
  pending,
  overlayFor,
  onCapture,
  error,
}: {
  cycle: UpdateCycleLocal
  poses: readonly Pose[]
  thumbs: ReadonlyMap<string, PhotoThumbLocal>
  pending: ReadonlySet<string>
  /** The previous cycle's photo of a pose (a thumbnail or a signed URL), or null. */
  overlayFor(pose: string): Promise<string | null>
  onCapture(pose: string, blob: Blob): Promise<void>
  error: string | null
}) {
  const [camera, setCamera] = useState<{ pose: Pose; overlay: string | null } | null>(null)

  const stateOf = (pose: string): PoseState =>
    pending.has(pose) ? 'pending' : cycle.photos.some((p) => p.pose === pose) ? 'sent' : 'missing'

  const open = async (pose: Pose) => {
    let overlay: string | null = null
    try {
      overlay = await overlayFor(pose.key)
    } catch {
      // Without the previous photo the camera still works.
    }
    setCamera({ pose, overlay })
  }

  const done = poses.filter((p) => stateOf(p.key) !== 'missing').length

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted">
        {done} de {poses.length} poses. Mesma luz, mesmo lugar e mesma distância do ciclo anterior.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {poses.map((pose) => (
          <PoseTile
            key={pose.key}
            pose={pose}
            state={stateOf(pose.key)}
            thumb={thumbs.get(pose.key)?.dataUrl ?? null}
            onTake={() => void open(pose)}
          />
        ))}
      </ul>
      {camera && (
        <PoseCamera
          pose={camera.pose}
          overlayUrl={camera.overlay}
          onCancel={() => setCamera(null)}
          onCapture={(blob) => {
            const pose = camera.pose.key
            setCamera(null)
            void onCapture(pose, blob)
          }}
        />
      )}
    </div>
  )
}
