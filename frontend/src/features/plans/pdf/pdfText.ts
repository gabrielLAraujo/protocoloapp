// The legacy build: it carries the polyfills older Android WebViews (and Node 22) need, e.g. Promise.try.
// The worker file only: pdf.js itself is loaded on demand (dynamic import below), so it stays out of the main bundle.
// `?worker&url` makes Vite bundle the worker as its own .js file (precached with the app shell, served with a JS MIME type).
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?worker&url'

/** One text run of a line, at its left edge `x` (PDF points, origin at the bottom left of the page). */
export type PdfLineItem = { x: number; text: string }

/** Text runs that share a baseline, left to right; `text` joins them with spaces where the PDF leaves a gap. */
export type PdfLine = { page: number; y: number; items: PdfLineItem[]; text: string }

/** A positioned text run as pdf.js reports it (`width`/`height` in points). */
export type TextPiece = { page: number; x: number; y: number; width: number; height: number; text: string }

/** Runs whose baselines differ by at most this much (points) are on the same line. */
export const LINE_TOLERANCE = 2.5

/**
 * Groups text runs into lines: same page and baseline within `tolerance`. Lines come sorted by page, then top to bottom
 * (y descending), runs inside a line left to right. Whitespace-only runs only matter as separators.
 */
export function groupTextItems(pieces: readonly TextPiece[], tolerance = LINE_TOLERANCE): PdfLine[] {
  const sorted = pieces
    .filter((p) => p.text.length > 0)
    .slice()
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)

  const groups: { page: number; y: number; pieces: TextPiece[] }[] = []
  for (const piece of sorted) {
    const current = groups.at(-1)
    if (current && current.page === piece.page && Math.abs(current.y - piece.y) <= tolerance) current.pieces.push(piece)
    else groups.push({ page: piece.page, y: piece.y, pieces: [piece] })
  }

  return groups
    .map((group) => {
      const runs = group.pieces.slice().sort((a, b) => a.x - b.x)
      return {
        page: group.page,
        y: group.y,
        items: runs.filter((r) => r.text.trim() !== '').map((r) => ({ x: r.x, text: r.text.trim() })),
        text: joinRuns(runs),
      }
    })
    .filter((line) => line.items.length > 0)
}

function joinRuns(runs: readonly TextPiece[]): string {
  let text = ''
  let end = Number.NEGATIVE_INFINITY
  for (const run of runs) {
    if (text !== '' && !/\s$/.test(text) && !/^\s/.test(run.text)) {
      // A visible gap between two runs is a space the PDF did not encode as a character.
      const gap = run.x - end
      if (gap > Math.max(1, run.height * 0.15)) text += ' '
    }
    text += run.text
    end = Math.max(end, run.x + run.width)
  }
  return text.replace(/\s+/g, ' ').trim()
}

type PdfjsTextItem = { str: string; transform: number[]; width: number; height: number }

/**
 * Reads every text run of a PDF (with pdf.js, on the device) and groups them into lines. A PDF without selectable text
 * (a scan) comes back as no lines. `data` is copied: pdf.js detaches the buffer it is given.
 */
export async function extractPdfLines(data: ArrayBuffer): Promise<PdfLine[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // In the browser this starts a real worker. Without `Worker` (Node, Vitest) pdf.js runs its worker code on the main
  // thread; a test loads `pdfjs-dist/legacy/build/pdf.worker.mjs` first so that code is already there.
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const task = pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), disableFontFace: true })
  try {
    const doc = await task.promise
    const pieces: TextPiece[] = []
    for (let page = 1; page <= doc.numPages; page++) {
      const content = await (await doc.getPage(page)).getTextContent()
      for (const item of content.items) {
        if (!('str' in item)) continue
        const { str, transform, width, height } = item as PdfjsTextItem
        pieces.push({ page, x: transform[4], y: transform[5], width, height, text: str })
      }
    }
    return groupTextItems(pieces)
  } finally {
    await task.destroy()
  }
}
