import type { Technique, TechniqueType } from './planDocuments'

/** Short label and one-sentence explanation (pt-BR) of each structured technique, shown on the exercise tag. */
export const TECHNIQUE_INFO: Record<TechniqueType, { label: string; explanation: string }> = {
  drop: { label: 'Drop', explanation: 'Ao terminar a série, reduza a carga cerca de 20% e continue sem descanso.' },
  rest_pause: { label: 'Rest-pause', explanation: 'Descanse 10–15 s e faça mais repetições com a mesma carga.' },
  biset: { label: 'Bi-set', explanation: 'Faça os dois exercícios em sequência, sem descanso entre eles.' },
  sst: { label: 'SST', explanation: 'Faça as séries uma após a outra, com os intervalos curtos indicados e a mesma carga.' },
  peak: { label: 'Pico de contração', explanation: 'Segure a contração por alguns segundos no ponto de maior tensão.' },
  isometric: { label: 'Isometria', explanation: 'Segure a posição de maior tensão, parado, pelo tempo indicado.' },
  partials: { label: 'Parciais', explanation: 'Depois da falha, continue com repetições curtas, em amplitude parcial.' },
  zero_point: { label: 'Ponto zero', explanation: 'Faça uma pausa no ponto zero do movimento, sem impulso, pelo tempo indicado.' },
  progressive_load: { label: 'Carga progressiva', explanation: 'Aumente a carga a cada série, mantendo a técnica.' },
  stretch_interval: { label: 'Intervalo alongado', explanation: 'Alongue o músculo trabalhado durante o intervalo.' },
  eccentric: { label: 'Excêntrica', explanation: 'Desça a carga devagar, controlando a fase excêntrica.' },
  cluster: { label: 'Cluster set', explanation: 'Faça mini-séries com uma pausa curta entre elas.' },
  fst7: { label: 'FST-7', explanation: '7 séries com descanso curto (30–45 s), buscando o máximo de pump.' },
  tempo: { label: 'Cadência', explanation: 'Controle a velocidade da subida e da descida.' },
  to_failure: { label: 'Até a falha', explanation: 'Leve a série até a falha.' },
}

export const techniqueLabel = (technique: Technique): string => TECHNIQUE_INFO[technique.type].label

/** The explanation, with the numbers of this technique filled in where the sentence has one (peak, eccentric, cluster…). */
export function techniqueExplanation(technique: Technique): string {
  switch (technique.type) {
    case 'peak':
      return `Segure a contração por ${technique.seconds} s no ponto de maior tensão.`
    case 'isometric':
      return `Segure a posição de maior tensão, parado, por ${technique.seconds} s.`
    case 'zero_point':
      return `Faça uma pausa de ${technique.seconds} s no ponto zero do movimento, sem impulso.`
    case 'drop':
      if (technique.percent) {
        return `Ao terminar a série, reduza a carga cerca de ${technique.percent}% e continue sem descanso.${technique.count > 1 ? ` Faça ${technique.count} drops.` : ''}`
      }
      return `${TECHNIQUE_INFO.drop.explanation}${technique.count > 1 ? ` Faça ${technique.count} drops.` : ''}`
    case 'rest_pause':
      return `${TECHNIQUE_INFO.rest_pause.explanation}${technique.count > 1 ? ` Faça ${technique.count} rest-pauses.` : ''}`
    case 'sst':
      return `Faça as séries uma após a outra, com intervalos de ${technique.rests.join(', ')} s e a mesma carga.`
    case 'partials':
      return technique.reps
        ? `Depois da falha, continue com ${technique.reps} repetições parciais, em amplitude curta.`
        : TECHNIQUE_INFO.partials.explanation
    case 'eccentric':
      return `Desça a carga devagar, em cerca de ${technique.seconds} s.`
    case 'cluster':
      return `Faça mini-séries de ${technique.reps.join('-')} repetições com ${technique.restSeconds} s de pausa entre elas.`
    case 'fst7':
      return technique.restSeconds
        ? `7 séries com descanso curto (${technique.restSeconds} s), buscando o máximo de pump.`
        : TECHNIQUE_INFO.fst7.explanation
    case 'tempo':
      return technique.text.split(':').length === 2
        ? `Cadência ${technique.text} (subida:descida em segundos).`
        : `Cadência ${technique.text} (segundos de cada fase do movimento).`
    default:
      return TECHNIQUE_INFO[technique.type].explanation
  }
}
