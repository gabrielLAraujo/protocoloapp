import { useEffect, useState } from 'react'
import { catalogRepo, type CatalogExercise } from '../data/catalogRepo'
import { useData } from '../data/dataContext'
import { useCatalogChanges } from '../data/useCatalogChanges'
import { bodyPartLabel, muscleLabel, youtubeSearchUrl } from '../domain/catalogLabels'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { buttonClasses } from './styles'

type Props = {
  /** The exercise's item in the device catalog; without it (or when it is gone from the catalog) only the YouTube link shows. */
  catalogId?: string | null
  name: string
  size: 'thumb' | 'card'
}

const LINK_TEXT = 'Ver no YouTube'

function YoutubeLink({ name, className }: { name: string; className?: string }) {
  return (
    <a href={youtubeSearchUrl(name)} target="_blank" rel="noopener" className={className ?? 'text-sm font-semibold text-accent underline'}>
      {LINK_TEXT}
    </a>
  )
}

const unique = (tags: string[], label: (tag: string) => string) => [...new Set(tags.map(label))].join(', ')

/**
 * The exercise's demonstration from the device catalog: a GIF in a box of fixed proportion (no layout shift), tap to enlarge,
 * and a YouTube search for the execution. Works without a catalog: then it is only the YouTube link.
 */
export function ExerciseMedia({ catalogId, name, size }: Props) {
  const data = useData()
  const db = data?.db
  const [loaded, setLoaded] = useState<{ id: string; item: CatalogExercise | null } | null>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  // An exercise opened before the catalog arrived reads its item again when the download lands (no need to leave the screen).
  const catalogChanges = useCatalogChanges()

  useEffect(() => {
    if (!db || !catalogId) return
    let cancelled = false
    catalogRepo
      .get(db, catalogId)
      .then((item) => {
        if (!cancelled) setLoaded({ id: catalogId, item })
      })
      .catch((error: unknown) => {
        console.error('could not read the exercise catalog', error)
        if (!cancelled) setLoaded({ id: catalogId, item: null })
      })
    return () => {
      cancelled = true
    }
  }, [db, catalogId, catalogChanges])

  const box = size === 'thumb' ? 'size-16' : 'aspect-[4/3] w-full max-w-xs'
  const settled = catalogId ? loaded?.id === catalogId : true
  // The item is still being read: keep the box it will fill, so nothing moves when the GIF appears.
  if (catalogId && db && !settled) return <div aria-hidden="true" data-testid="media-loading" className={`${box} rounded-control border border-line bg-raised`} />
  const item = catalogId && loaded?.id === catalogId ? loaded.item : null
  if (!item) return <YoutubeLink name={name} />

  const gif = item.gifUrl
  const broken = gif === null || failedUrl === gif
  // Inside the labelled button the name comes from the button; in the enlarged view the image is the content.
  const image = (className: string, alt = '') =>
    broken ? (
      <span className={`grid place-items-center text-muted ${className}`} data-testid="media-placeholder">
        <Icon name="dumbbell" size={size === 'thumb' ? 24 : 40} />
      </span>
    ) : (
      <img src={gif} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(gif)} className={`object-contain ${className}`} />
    )

  const body = unique(item.bodyParts, bodyPartLabel)
  const muscles = unique(item.targetMuscles, muscleLabel)

  return (
    <div className="grid justify-items-start gap-1">
      <button
        type="button"
        aria-label={`Ampliar demonstração de ${name}`}
        onClick={() => setOpen(true)}
        className={`${box} shrink-0 overflow-hidden rounded-control border border-line bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
      >
        {image('size-full')}
      </button>
      {size === 'card' && <YoutubeLink name={name} />}
      {open && (
        <Sheet title={name} onCancel={() => setOpen(false)}>
          <div className="grid justify-items-center">
            <div className="aspect-[4/3] w-full max-w-sm overflow-hidden rounded-control border border-line bg-raised">{image('size-full', `Demonstração: ${name}`)}</div>
          </div>
          {(body || muscles) && (
            <dl className="grid gap-1 text-sm">
              {muscles && (
                <div className="flex gap-2">
                  <dt className="font-semibold">Músculos:</dt>
                  <dd className="text-muted">{muscles}</dd>
                </div>
              )}
              {body && (
                <div className="flex gap-2">
                  <dt className="font-semibold">Região:</dt>
                  <dd className="text-muted">{body}</dd>
                </div>
              )}
            </dl>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClasses({ variant: 'primary' })} onClick={() => setOpen(false)}>
              Fechar
            </button>
            <YoutubeLink name={name} className={buttonClasses({ variant: 'secondary' })} />
          </div>
        </Sheet>
      )}
    </div>
  )
}
