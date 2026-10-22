import type { components } from '../../api/schema'

export type PlanDiff = components['schemas']['PlanDiffDto']

const show = (value: unknown): string => {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

const row = 'flex items-start gap-3 px-4 py-3 text-sm'
const sign = 'grid size-6 shrink-0 place-items-center rounded-control font-bold'

/** What changes against the active version: added (+), removed (−), changed (~). Not only color: the sign and a hidden word say it too. */
export function DiffList({ diff }: { diff: PlanDiff | null }) {
  if (!diff) return <p className="text-sm text-muted">Não há versão ativa para comparar.</p>
  if (diff.added.length + diff.removed.length + diff.changed.length === 0) {
    return <p className="text-sm text-muted">Sem diferenças em relação à versão ativa.</p>
  }
  return (
    <ul aria-label="Mudanças em relação à versão ativa" className="divide-y divide-line overflow-hidden rounded-control border border-line">
      {diff.added.map((path) => (
        <li key={`a-${path}`} className={row}>
          <span aria-hidden="true" className={`${sign} bg-ok/10 text-ok`}>
            +
          </span>
          <span className="sr-only">Adicionado:</span>
          <code className="break-all">{path}</code>
        </li>
      ))}
      {diff.removed.map((path) => (
        <li key={`r-${path}`} className={row}>
          <span aria-hidden="true" className={`${sign} bg-danger/10 text-danger`}>
            −
          </span>
          <span className="sr-only">Removido:</span>
          <code className="break-all">{path}</code>
        </li>
      ))}
      {diff.changed.map((change) => (
        <li key={`c-${change.path}`} className={row}>
          <span aria-hidden="true" className={`${sign} bg-warn/10 text-warn`}>
            ~
          </span>
          <span className="sr-only">Alterado:</span>
          <span className="grid gap-1">
            <code className="break-all">{change.path}</code>
            <span className="text-muted">
              {show(change.before)} <span aria-hidden="true">→</span>
              <span className="sr-only">para</span> {show(change.after)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}
