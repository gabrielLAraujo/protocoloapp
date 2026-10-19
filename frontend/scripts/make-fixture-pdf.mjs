// Writes the fictitious one-page PDF used by the e2e (frontend/e2e/fixtures/ficha-ficticia.pdf). No dependencies: a tiny
// hand-built PDF. Nothing in it is real. Run `node scripts/make-fixture-pdf.mjs` to regenerate it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const lines = ['FICHA FICTICIA (exemplo para teste)', 'Treino A - Exemplo: Exercicio Ficticio Alfa 3 x 10', 'Treino B - Exemplo: Exercicio Ficticio Beta 3 x 12', 'Rotacao: A, B, descanso']

const stream = `BT /F1 12 Tf 50 780 Td 16 TL ${lines.map((l) => `(${l}) Tj T*`).join(' ')} ET`
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
]

let pdf = '%PDF-1.4\n'
const offsets = []
objects.forEach((body, i) => {
  offsets.push(pdf.length)
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
})
const xref = pdf.length
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../e2e/fixtures/ficha-ficticia.pdf')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, pdf, 'latin1')
console.log(`wrote ${out} (${pdf.length} bytes)`)
