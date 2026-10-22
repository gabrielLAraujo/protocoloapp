// @vitest-environment node
// pdf.js streams the text through ReadableStream, which the jsdom globals of the vmThreads pool do not have.
import { beforeAll, describe, expect, it } from 'vitest'
import { extractPdfLines, groupTextItems, type TextPiece } from './pdfText'

const piece = (text: string, x: number, y: number, page = 1, width = text.length * 5): TextPiece => ({
  page,
  x,
  y,
  width,
  height: 10,
  text,
})

describe('groupTextItems', () => {
  it('groups runs by baseline within the tolerance and sorts by page, top to bottom, left to right', () => {
    const lines = groupTextItems([
      piece('segunda', 72, 700, 2),
      piece('linha', 110, 699),
      piece('Primeira', 72, 720),
      piece('Segunda', 72, 701),
      piece('direita', 400, 720.8),
    ])
    expect(lines.map((l) => [l.page, l.text])).toEqual([
      [1, 'Primeira direita'],
      [1, 'Segunda linha'],
      [2, 'segunda'],
    ])
    expect(lines[0].items).toEqual([
      { x: 72, text: 'Primeira' },
      { x: 400, text: 'direita' },
    ])
  })

  it('splits runs whose baselines are further apart than the tolerance', () => {
    expect(groupTextItems([piece('a', 72, 700), piece('b', 72, 696)]).map((l) => l.text)).toEqual(['a', 'b'])
  })

  it('adds a space only where the PDF leaves a gap, and drops whitespace-only runs from the items', () => {
    const lines = groupTextItems([
      piece('Exerc', 72, 700, 1, 25),
      piece('icio', 97, 700, 1, 20), // touches the previous run: same word
      piece(' ', 117, 700, 1, 3),
      piece('um', 120, 700, 1, 10),
      piece('(3x10)', 140, 700, 1, 30), // 10 pt gap: a space
    ])
    expect(lines[0].text).toBe('Exercicio um (3x10)')
    expect(lines[0].items.map((i) => i.text)).toEqual(['Exerc', 'icio', 'um', '(3x10)'])
  })

  it('returns no lines for no text', () => {
    expect(groupTextItems([piece('', 72, 700), piece('   ', 72, 680)])).toEqual([])
  })
})

/** A one-page PDF with Helvetica text at the given positions, built by hand (offsets for the xref computed here). */
function makePdf(texts: { x: number; y: number; text: string }[]): ArrayBuffer {
  const stream = texts.map((t) => `BT /F1 12 Tf ${t.x} ${t.y} Td (${t.text}) Tj ET`).join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf).buffer as ArrayBuffer
}

describe('extractPdfLines', () => {
  beforeAll(async () => {
    // No Worker here: pdf.js runs its worker code on the main thread once the module is loaded.
    await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  })

  it('reads the text of a PDF into sorted lines', async () => {
    const data = makePdf([
      { x: 72, y: 700, text: '- Exercicio um (3x10 a 15)' },
      { x: 72, y: 760, text: '(treino) 3x 8 a 12' },
      { x: 300, y: 760, text: 'coluna' },
    ])
    const lines = await extractPdfLines(data)
    expect(lines.map((l) => l.text)).toEqual(['(treino) 3x 8 a 12 coluna', '- Exercicio um (3x10 a 15)'])
    expect(lines[0]).toMatchObject({ page: 1, y: 760 })
    expect(lines[0].items.map((i) => i.x)).toEqual([72, 300])
    expect(data.byteLength).toBeGreaterThan(0) // the caller's buffer is not detached
  })

  it('returns no lines for a PDF without text (a scan)', async () => {
    expect(await extractPdfLines(makePdf([]))).toEqual([])
  })
})
