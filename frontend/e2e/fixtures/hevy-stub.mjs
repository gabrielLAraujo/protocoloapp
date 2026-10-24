// A stand-in for the Hevy public API, for the e2e only: the subset HevyClient reads (`/v1/user/info`, `/v1/workouts`,
// `/v1/workouts/events`, `/v1/workouts/{id}`, `/v1/exercise_templates`), snake_case and paged like the real one. Only the
// fictitious key below is accepted (anything else is 401). It serves ONE fictitious workout dated today in São Paulo, titled
// like day A of the e2e sheet ("Treino A - Exemplo", e2e/fixtures/make-pdfs.mjs) so the importer picks that day by name:
//   - "Exercicio Ficticio Alfa" is already an exercise of the sheet: linked automatically (same name);
//   - "Exercicio Ficticio Hevy" is new: a provisional exercise, waiting for confirmation (its group comes from the templates).
// Every call is recorded (path and whether the key was right, never the key): `GET /__requests`. Plain Node, no
// dependencies. Run: `node hevy-stub.mjs [port]` (default 9102).
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? process.env.PORT ?? 9102)
const API_KEY = 'test-key-0000-0000-0000-000000000001'
const requests = []

const SAO_PAULO_OFFSET_MS = 3 * 3600_000 // UTC-3, no DST (as the backend's zone)

/**
 * The workout, built on the first request and then fixed (same `updated_at` on every call, so a second sync is
 * "unchanged"). It starts at most 45 minutes ago but never before São Paulo's midnight, so its local date is today.
 */
let workout = null
function theWorkout() {
  if (workout) return workout
  const now = Date.now()
  const localMidnight = Math.floor((now - SAO_PAULO_OFFSET_MS) / 86_400_000) * 86_400_000 + SAO_PAULO_OFFSET_MS
  const start = Math.max(now - 45 * 60_000, localMidnight + 1000)
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const set = (index, weight, reps, type = 'normal') => ({
    index,
    type,
    weight_kg: weight,
    reps,
    distance_meters: null,
    duration_seconds: null,
    rpe: null,
    custom_metric: null,
  })
  workout = {
    id: '00000000-0000-4000-8000-00000000e2e1',
    title: 'Treino A - Exemplo',
    routine_id: null,
    description: 'Nota ficticia do Hevy',
    start_time: iso(start),
    end_time: iso(Math.max(start + 1000, now - 1000)),
    updated_at: iso(now - 1000),
    created_at: iso(now - 1000),
    exercises: [
      {
        index: 0,
        title: 'Exercicio Ficticio Alfa',
        notes: '',
        exercise_template_id: 'E2E00001',
        superset_id: null,
        sets: [set(0, 20, 12, 'warmup'), set(1, 50, 10), set(2, 52.5, 8)],
      },
      {
        index: 1,
        title: 'Exercicio Ficticio Hevy',
        notes: '',
        exercise_template_id: 'E2E00002',
        superset_id: null,
        sets: [set(0, 30, 12), set(1, 30, 10)],
      },
    ],
  }
  return workout
}

const templates = [
  { id: 'E2E00001', title: 'Exercicio Ficticio Alfa', type: 'weight_reps', primary_muscle_group: 'chest', secondary_muscle_groups: [], is_custom: true },
  { id: 'E2E00002', title: 'Exercicio Ficticio Hevy', type: 'weight_reps', primary_muscle_group: 'quadriceps', secondary_muscle_groups: [], is_custom: true },
]

function send(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

/** One page of `items` (1-based `page`, `pageSize` as asked, capped like Hevy's limits). */
function paged(url, name, items, maxSize) {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1)
  const size = Math.min(maxSize, Math.max(1, Number(url.searchParams.get('pageSize') ?? maxSize) || maxSize))
  const pageCount = Math.max(1, Math.ceil(items.length / size))
  return { page, page_count: pageCount, [name]: items.slice((page - 1) * size, page * size) }
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://stub')
  if (req.method === 'GET' && url.pathname === '/__requests') return send(res, 200, requests)

  const authorized = req.headers['api-key'] === API_KEY
  requests.push({ method: req.method, path: url.pathname, authorized })
  if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' })
  if (!authorized) return send(res, 401, { error: 'Unauthorized' })

  if (url.pathname === '/v1/user/info') return send(res, 200, { data: { id: 'e2e-user', name: 'Usuario Ficticio', url: 'https://example.com/e2e' } })

  if (url.pathname === '/v1/workouts') return send(res, 200, paged(url, 'workouts', [theWorkout()], 10))

  if (url.pathname === '/v1/workouts/events') {
    const since = Date.parse(url.searchParams.get('since') ?? '')
    const w = theWorkout()
    const events = Number.isFinite(since) && Date.parse(w.updated_at) <= since ? [] : [{ type: 'updated', workout: w }]
    return send(res, 200, paged(url, 'events', events, 10))
  }

  const one = url.pathname.match(/^\/v1\/workouts\/([^/]+)$/)
  if (one) {
    const w = theWorkout()
    return decodeURIComponent(one[1]) === w.id ? send(res, 200, w) : send(res, 404, { error: 'Workout not found' })
  }

  if (url.pathname === '/v1/exercise_templates') return send(res, 200, paged(url, 'exercise_templates', templates, 100))

  send(res, 404, { error: 'not found' })
}).listen(port, '127.0.0.1', () => console.log(`hevy stub on http://127.0.0.1:${port}`))
