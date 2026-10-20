/** pt-BR names for the tags the exercise catalog (ExerciseDB) writes in English. An unknown tag shows as it came. */
const BODY_PARTS: Record<string, string> = {
  back: 'Costas',
  cardio: 'Cardio',
  chest: 'Peito',
  'lower arms': 'Antebraços',
  'lower legs': 'Panturrilhas',
  neck: 'Pescoço',
  shoulders: 'Ombros',
  'upper arms': 'Braços',
  'upper legs': 'Pernas',
  waist: 'Abdômen',
}

const MUSCLES: Record<string, string> = {
  abductors: 'Abdutores',
  abs: 'Abdômen',
  adductors: 'Adutores',
  biceps: 'Bíceps',
  calves: 'Panturrilhas',
  'cardiovascular system': 'Sistema cardiovascular',
  delts: 'Deltoides',
  forearms: 'Antebraços',
  glutes: 'Glúteos',
  hamstrings: 'Posteriores de coxa',
  lats: 'Dorsais',
  'levator scapulae': 'Elevador da escápula',
  pectorals: 'Peitorais',
  quads: 'Quadríceps',
  'serratus anterior': 'Serrátil anterior',
  spine: 'Lombar',
  traps: 'Trapézio',
  triceps: 'Tríceps',
  'upper back': 'Parte superior das costas',
}

const lookup = (table: Record<string, string>, tag: string) => table[tag.trim().toLowerCase()] ?? tag

export const bodyPartLabel = (tag: string) => lookup(BODY_PARTS, tag)
export const muscleLabel = (tag: string) => lookup(MUSCLES, tag)

/** The YouTube search for how to perform the exercise (in Portuguese). */
export const youtubeSearchUrl = (name: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} execução`)}`
