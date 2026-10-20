import { useId, useState } from 'react'
import type { Technique } from '../../domain/planDocuments'
import { techniqueExplanation, techniqueLabel } from '../../domain/techniques'

/**
 * The structured techniques of an exercise as tags. Tapping one opens its one-sentence explanation right below (a
 * disclosure: `aria-expanded` on the tag, the text announced politely); tapping it again or "Fechar" closes it.
 */
export function TechniqueChips({ techniques }: { techniques: Technique[] }) {
  const [open, setOpen] = useState<number | null>(null)
  const id = useId()
  if (techniques.length === 0) return null
  const shown = open !== null ? techniques[open] : undefined

  return (
    <div className="grid gap-2">
      <ul aria-label="Técnicas" className="flex flex-wrap gap-2">
        {techniques.map((technique, i) => (
          <li key={`${technique.type}:${i}`}>
            <button
              type="button"
              aria-expanded={open === i}
              aria-controls={`${id}-explanation`}
              onClick={() => setOpen(open === i ? null : i)}
              className={`min-h-11 rounded-full border px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                open === i ? 'border-accent bg-accent text-on-accent' : 'border-accent/40 bg-accent-soft text-accent hover:border-accent'
              }`}
            >
              {techniqueLabel(technique)}
            </button>
          </li>
        ))}
      </ul>
      <div id={`${id}-explanation`} aria-live="polite">
        {shown && (
          <div className="flex items-start justify-between gap-3 rounded-control border border-accent/30 bg-accent-soft p-3 text-sm">
            <p>
              <span className="font-semibold">{techniqueLabel(shown)}: </span>
              {techniqueExplanation(shown)}
            </p>
            <button type="button" className="shrink-0 font-semibold text-accent underline" onClick={() => setOpen(null)}>
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
