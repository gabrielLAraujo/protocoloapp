import type { components } from '../../api/schema'

export type PlanDiff = components['schemas']['PlanDiffDto']

const show = (value: unknown): string => {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

const row = 'flex items-start gap-2 rounded-control border px-3 py-2 text-sm'

/** What changes against the active version: added (+), removed (−), changed (~). Not only color: the sign and a hidden word say it too. */
export function DiffList({ diff }: { diff: PlanDiff | null }) {
  if (!diff) return <p className="text-sm text-muted">Não há versão ativa para comparar.</p>
  if (diff.added.length + diff.removed.length + diff.changed.length === 0) {
    return <p className="text-sm text-muted">Sem diferenças em relação à versão ativa.</p>
  }
  return (
    <ul aria-label="Mudanças em relação à versão ativa" className="grid gap-1.5">
      {diff.added.map((path) => (
        <li key={`a-${path}`} className={`${row} border-ok/40 bg-ok/10`}>
          <span aria-hidden="true" className="font-bold text-ok">
            +
          </span>
          <span className="sr-only">Adicionado:</span>
          <code className="break-all">{path}</code>
        </li>
      ))}
      {diff.removed.map((path) => (
        <li key={`r-${path}`} className={`${row} border-danger/40 bg-danger/10`}>
          <span aria-hidden="true" className="font-bold text-danger">
            −
          </span>
          <span className="sr-only">Removido:</span>
          <code className="break-all">{path}</code>
        </li>
      ))}
      {diff.changed.map((change) => (
        <li key={`c-${change.path}`} className={`${row} border-warn/40 bg-warn/10`}>
          <span aria-hidden="true" className="font-bold text-warn">
            ~
          </span>
          <span className="sr-only">Alterado:</span>
          <span className="grid gap-0.5">
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
