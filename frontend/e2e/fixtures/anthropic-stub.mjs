// A stand-in for the Anthropic Messages API, for the e2e only: `POST /v1/messages` answers with a valid, fictitious
// `tool_use` for the tool the backend forced (`tool_choice.name`). Every call is recorded so the test can check that the
// PDF really was sent: `GET /__requests`. Plain Node, no dependencies. Run: `node anthropic-stub.mjs [port]` (default 9100).
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? process.env.PORT ?? 9100)
const requests = []

// "Today" as the backend sees it (Brazil, UTC-3, no DST), plus an offset in days, as yyyy-mm-dd.
function date(offsetDays = 0) {
  return new Date(Date.now() - 3 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10)
}

function workout() {
  const sets = (count) => Array.from({ length: count }, () => ({ repsMin: 8, repsMax: 12, technique: null }))
  const exercise = (key, name, count) => ({
    key,
    exerciseId: null,
    name,
    sets: sets(count),
    restSeconds: null,
    restSequence: null,
    technique: null,
    supersetWith: null,
  })
  return {
    document: {
      rotation: { type: 'sequence', items: ['A', 'B', 'off'], anchor: null, map: null },
      days: [
        { key: 'A', name: 'Treino A - Exemplo', notes: null, exercises: [exercise('A1', 'Exercicio Ficticio Alfa', 3), exercise('A2', 'Exercicio Ficticio Gama', 2)] },
        { key: 'B', name: 'Treino B - Exemplo', notes: null, exercises: [exercise('B1', 'Exercicio Ficticio Beta', 3)] },
      ],
    },
    lowConfidence: [],
    newExercises: [
      { name: 'Exercicio Ficticio Alfa', group: 'chest' },
      { name: 'Exercicio Ficticio Beta', group: 'back' },
      { name: 'Exercicio Ficticio Gama', group: 'quads' },
    ],
  }
}

function protocol() {
  return {
    document: {
      phaseName: 'Fase Ficticia',
      updateDate: date(30),
      billingDate: null,
      meals: [
        {
          key: 'meal_1',
          label: 'Refeicao 1',
          items: [{ food: 'Alimento ficticio', grams: 100, alternatives: ['Alternativa ficticia'] }],
          notes: null,
        },
      ],
      items: [
        {
          key: 'it_1',
          category: 'supplement',
          name: 'Suplemento ficticio',
          doseText: '2 capsulas (dose ficticia)',
          timing: 'with_meal:meal_1',
          schedule: { type: 'daily', days: null, n: null, anchor: null },
        },
        {
          key: 'it_2',
          category: 'compound',
          name: 'Composto ficticio',
          doseText: '1 dose a cada 3 dias',
          timing: 'any',
          schedule: { type: 'every_n_days', days: null, n: 3, anchor: date(0) },
        },
      ],
      cardio: { sessionsPerWeek: 3, daily: null, durationMin: 30, intensity: 'leve', preferredTime: null },
      guidelines: [
        { kind: 'water_min_l', value: 4, text: null },
        { kind: 'text', value: null, text: 'Orientacao ficticia' },
      ],
      trainingSplitNote: null,
    },
    lowConfidence: [],
  }
}

const builders = { submit_workout: workout, submit_protocol: protocol }

function record(body) {
  const pdf = body?.messages?.[0]?.content?.find?.((block) => block?.type === 'document')
  const data = pdf?.source?.type === 'base64' ? Buffer.from(pdf.source.data ?? '', 'base64') : null
  requests.push({
    tool: body?.tool_choice?.name ?? null,
    model: body?.model ?? null,
    pdfMediaType: pdf?.source?.media_type ?? null,
    pdfBytes: data?.length ?? 0,
    pdfIsPdf: data?.subarray(0, 5).toString('latin1') === '%PDF-',
    pdfSha256: data ? createHash('sha256').update(data).digest('hex') : null,
  })
}

function send(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://stub')
  if (req.method === 'GET' && url.pathname === '/__requests') return send(res, 200, requests)
  if (req.method !== 'POST' || url.pathname !== '/v1/messages') return send(res, 404, { type: 'error', error: { type: 'not_found_error', message: 'not found' } })

  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    let body
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return send(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'invalid JSON' } })
    }
    record(body)
    const build = builders[body?.tool_choice?.name]
    if (!build) return send(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'unknown tool' } })
    send(res, 200, {
      id: `msg_stub_${requests.length}`,
      type: 'message',
      role: 'assistant',
      model: body.model ?? 'stub',
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: `toolu_stub_${requests.length}`, name: body.tool_choice.name, input: build() }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })
  })
}).listen(port, '127.0.0.1', () => console.log(`anthropic stub on http://127.0.0.1:${port}`))
