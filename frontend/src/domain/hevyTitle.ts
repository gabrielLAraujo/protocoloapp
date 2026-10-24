/**
 * Turns an exercise title from Hevy into a name the sheet matcher understands: the equipment in parentheses becomes a
 * plain word ("Bench Press (Barbell)" → "Bench Press  barra ") and the English equipment names become the canonical
 * pt-BR equipment tokens. Mirrored by the backend `ExerciseWords.FromHevyTitle` (shared cases in
 * `fixtures/exercise-match-cases.json`).
 */

/** English equipment names, longest first (`smith machine` before `machine`). Whole words only, any case. */
const EQUIPMENT_NAMES: readonly (readonly [RegExp, string])[] = [
  [/(?<![\p{L}\p{N}])smith machine(?![\p{L}\p{N}])/giu, 'smith'],
  [/(?<![\p{L}\p{N}])barbell(?![\p{L}\p{N}])/giu, 'barra'],
  [/(?<![\p{L}\p{N}])dumbbell(?![\p{L}\p{N}])/giu, 'halter'],
  [/(?<![\p{L}\p{N}])cable(?![\p{L}\p{N}])/giu, 'polia'],
  [/(?<![\p{L}\p{N}])machine(?![\p{L}\p{N}])/giu, 'maquina'],
]

export function hevyTitleToSheetName(title: string): string {
  let name = title.replace(/\(([^)]*)\)/g, ' $1 ')
  for (const [pattern, token] of EQUIPMENT_NAMES) name = name.replace(pattern, token)
  return name
}
