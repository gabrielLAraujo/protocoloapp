const FILLER_WORDS = new Set(['com', 'de', 'no', 'na', 'em'])

/**
 * The key that matches the same exercise written differently in different PDFs. Mirrors the backend `ExerciseNames.Normalize`:
 * lowercase, no accents, no punctuation, without `c/`, `com`, `de`, `no`, `na`, `em`; single spaces.
 */
export function normalizeExerciseName(name: string): string {
  const plain = name.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  const withoutAbbreviation = plain.replace(/(?<![\p{L}\p{N}])c\//gu, ' ')
  return withoutAbbreviation
    .replace(/[^\p{L}\p{N}]/gu, ' ')
    .split(' ')
    .filter((word) => word !== '' && !FILLER_WORDS.has(word))
    .join(' ')
}
