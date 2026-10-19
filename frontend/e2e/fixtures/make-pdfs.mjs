// Fictitious PDFs for the e2e, in the layout of the consultancy's (Word exported to PDF), read on the device by
// src/features/plans/pdf. Everything in them is invented. Built by hand (Helvetica, WinAnsi text; no dependencies), in
// memory, so the protocol dates can follow "today". Run `node make-pdfs.mjs [dir]` to write both files and look at them.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** WinAnsi bytes (as a binary string) of a text, escaped for a PDF literal string. */
function winAnsi(text) {
  let out = ''
  for (const ch of text) {
    const code = ch === '•' ? 0x95 : ch.codePointAt(0)
    if (code > 0xff) throw new Error(`not in WinAnsi: ${ch}`)
    const byte = String.fromCharCode(code)
    out += byte === '(' || byte === ')' || byte === '\\' ? `\\${byte}` : byte
  }
  return out
}

/**
 * A PDF with one page per entry of `pages`; each page is a list of `{ x, y, text }` drawn in Helvetica 10 (A4, points,
 * origin at the bottom left). Returns a Buffer.
 */
export function buildPdf(pages) {
  const objects = []
  const add = (body) => objects.push(body) // object number = index + 1
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('') // pages, filled below
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const kids = []
  for (const texts of pages) {
    const stream = texts.map((t) => `BT /F1 10 Tf ${t.x} ${t.y} Td (${winAnsi(t.text)}) Tj ET`).join('\n')
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    const contents = objects.length
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contents} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`)
    kids.push(`${objects.length} 0 R`)
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`

  let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

/** Lines of text top to bottom at `x`, `gap` points apart. */
const column = (x, top, gap, texts) => texts.map((text, i) => ({ x, y: top - i * gap, text }))

/**
 * Workout sheet: a title, day headers `(name) default sets`, dash lines for the exercises (one wrapped onto the next
 * line, one without sets of its own), DESCANSO between blocks. Rotation A, B, off.
 */
export function workoutPdf() {
  return buildPdf([
    column(60, 780, 16, [
      'FICHA DE TREINO FICTÍCIA',
      '(Treino A - Exemplo) 3x 8 a 12',
      '- Exercicio Ficticio Alfa (3x 8 a 12) (intervalo 90 seg)',
      '- Exercicio Ficticio Gama (2x 10 a 12)',
      '(intervalo 1 min)',
      '(Treino B - Exemplo) 3x 8 a 12',
      '- Exercicio Ficticio Beta (intervalo 2 min)',
      'DESCANSO',
    ]),
  ])
}

/** "Today" in Brazil (UTC-3, no DST) plus `days`, as the date parts. */
function brazilDate(days) {
  const d = new Date(Date.now() - 3 * 3600_000 + days * 86_400_000)
  return { day: d.getUTCDate(), month: d.getUTCMonth() }
}
const spoken = ({ day, month }) => `${day} de ${MONTHS[month]}`

/**
 * Protocol: personal header (never read), dates without a year (update in 30 days, billing in 10), phase, a meal table
 * in three columns (labels left, bulleted foods in the middle, supplements right), cardio, water, free meals and a
 * compound section on the next pages.
 */
export function protocolPdf({ updateInDays = 30, billingInDays = 10 } = {}) {
  const LEFT = 48
  const BULLET = 170
  const FOOD = 188
  const RIGHT = 430
  const food = (y, text) => [
    { x: BULLET, y, text: '•' },
    { x: FOOD, y, text },
  ]
  const page1 = [
    { x: 60, y: 780, text: 'NOME: Pessoa Ficticia' },
    { x: 300, y: 780, text: 'PESO / ALTURA: 00kg / 0,00m' },
    { x: 60, y: 760, text: `DATA DE ATUALIZAÇÃO: ${spoken(brazilDate(updateInDays))}` },
    { x: 300, y: 760, text: `DATA DE MENSALIDADE: ${spoken(brazilDate(billingInDays))}` },
    { x: 60, y: 740, text: 'FASE: Fase Ficticia' },
    { x: 470, y: 740, text: 'SUPLEMENTOS' },
    // Row 1
    ...food(700, '100gr Alimento ficticio OU Alternativa ficticia'),
    { x: RIGHT, y: 700, text: '- 2 caps Suplemento ficticio' },
    { x: LEFT, y: 688, text: 'Refeicao 1' },
    ...food(688, '2 ovos ficticios'),
    // Row 2
    ...food(640, '150gr Peixe ficticio OU ovos'),
    { x: RIGHT, y: 640, text: '- 1 dose Sup. noturno (jejum)' },
    { x: LEFT, y: 628, text: 'Refeicao 2' },
    ...food(628, '120gr Arroz ficticio'),
  ]
  const page2 = [
    { x: 250, y: 780, text: 'PROTOCOLO DE CARDIO' },
    { x: 100, y: 760, text: '• Sessões na semana: 3 vezes' },
    { x: 100, y: 748, text: '• Duração do cardio: 30 minutos' },
    { x: 100, y: 736, text: '• Intensidade do cardio: leve' },
    { x: 95, y: 700, text: '• Direito a UMA refeição livre.' },
    { x: 95, y: 688, text: '• Consuma NO MÍNIMO: 3,5 litros diários' },
  ]
  const page3 = [
    { x: 180, y: 780, text: 'ERGOGÊNICOS E PROTETORES' },
    { x: 29, y: 760, text: 'PROTOCOLO DE COMPOSTOS:' },
    { x: 29, y: 748, text: 'COMPOSTO FICTICIO: 1 dose a cada 3 dias' },
  ]
  return buildPdf([page1, page2, page3])
}

/** A PDF with no text at all (what a scan looks like to the reader). */
export function scannedPdf() {
  return buildPdf([[]])
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? '.'
  writeFileSync(join(dir, 'treino-ficticio.pdf'), workoutPdf())
  writeFileSync(join(dir, 'protocolo-ficticio.pdf'), protocolPdf())
  console.log(`written to ${dir}`)
}
