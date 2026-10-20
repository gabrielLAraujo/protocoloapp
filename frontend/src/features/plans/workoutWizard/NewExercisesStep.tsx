import { useState } from 'react'
import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS, type MuscleGroup } from '../../../domain/muscleGroups'
import { ExerciseMedia } from '../../../ui/ExerciseMedia'
import { Sheet } from '../../../ui/Sheet'
import { SelectField } from '../fields'
import type { NewExercise } from '../newExercises'
import { buttonClass } from '../styles'
import { GifPreview, PairPicker } from './PairPicker'
import { useCatalogItem } from './useCatalogItem'

const GROUP_OPTIONS = MUSCLE_GROUPS.map((g) => ({ value: g, label: MUSCLE_GROUP_LABELS[g] }))

type Props = {
  newExercises: NewExercise[]
  groupsDisabled: boolean
  onGroupChange(id: string, group: MuscleGroup): void
  onCatalogChange(id: string, catalogId: string | null): void
}

/** The exercises the app does not have yet: each gets a muscle group and, to show its demonstration, a pair in the catalog. */
export function NewExercisesStep({ newExercises, groupsDisabled, onGroupChange, onCatalogChange }: Props) {
  const [picking, setPicking] = useState<NewExercise | null>(null)
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">Esses exercícios ainda não existem no seu catálogo. Confirme o grupo muscular e escolha o par com a demonstração.</p>
      <ul className="grid gap-2">
        {newExercises.map((ex) => (
          <li key={ex.id} className="grid gap-3 rounded-card border border-line bg-surface p-3 shadow-card">
            <div className="flex items-center gap-3">
              {ex.catalogId ? <ExerciseMedia catalogId={ex.catalogId} name={ex.name} size="thumb" /> : <GifPreview url={null} className="size-16" />}
              <div className="grid min-w-0 gap-0.5">
                <span className="font-semibold leading-snug">{ex.name}</span>
                <PairName catalogId={ex.catalogId ?? null} />
              </div>
            </div>
            <SelectField label={`Grupo de ${ex.name}`} value={ex.group} options={GROUP_OPTIONS} disabled={groupsDisabled} onChange={(group) => onGroupChange(ex.id, group as MuscleGroup)} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass} aria-label={`${ex.catalogId ? 'Trocar' : 'Escolher'} par de ${ex.name}`} onClick={() => setPicking(ex)}>
                {ex.catalogId ? 'Trocar par' : 'Escolher par'}
              </button>
              {ex.catalogId && (
                <button type="button" className={buttonClass} aria-label={`Remover par de ${ex.name}`} onClick={() => onCatalogChange(ex.id, null)}>
                  Remover par
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {picking && (
        <Sheet title={`Par de ${picking.name}`} onCancel={() => setPicking(null)}>
          <PairPicker
            name={picking.name}
            userExercises={[]}
            allowUser={false}
            onPickUser={() => undefined}
            onPickCatalog={(item) => {
              onCatalogChange(picking.id, item.id)
              setPicking(null)
            }}
          />
          <button type="button" className={buttonClass} onClick={() => setPicking(null)}>
            Cancelar
          </button>
        </Sheet>
      )}
    </div>
  )
}

function PairName({ catalogId }: { catalogId: string | null }) {
  const item = useCatalogItem(catalogId)
  return <span className="text-sm text-muted">{item ? `Par: ${item.name}` : catalogId ? 'Par escolhido' : 'Sem par: sem demonstração'}</span>
}
