import { afterEach, describe, expect, it, vi } from 'vitest'
import type { components } from '../api/schema'
import type { QuestionnaireTemplate } from '../domain/questionnaireTemplate'
import { json, mockFetch } from '../test/fetch-mock'
import { newLocalDb, newTestApi } from '../test/localDb'
import { outbox } from './outbox'
import { questionnaireTemplateRepo } from './questionnaireTemplateRepo'
import { SyncEngine } from './syncEngine'

type SyncChange = components['schemas']['SyncChange']
type SyncRecord = components['schemas']['SyncRecord']

const T0 = new Date('2026-10-19T12:00:00.000Z')
const later = (ms: number) => new Date(T0.getTime() + ms)

const template: QuestionnaireTemplate = {
  title: 'Modelo de exemplo',
  sections: [{ title: 'Seção de exemplo', questions: [{ key: 'q1', text: 'Como foi sua semana de exemplo?', kind: 'long_text', fill: 'checkin_notes' }] }],
  poses: [{ key: 'front', label: 'Frente' }],
}

afterEach(() => vi.unstubAllGlobals())

/** Last-writer-wins server as in todaySync.test.ts. */
function fakeServer() {
  const records = new Map<string, SyncRecord>()
  let version = 0
  mockFetch({
    'POST /api/sync/push': (call) => {
      const { changes } = JSON.parse(call.body) as { changes: SyncChange[] }
      const results = changes.map((c) => {
        const stored = records.get(c.id)
        if (stored && Date.parse(c.clientUpdatedAt) <= Date.parse(stored.clientUpdatedAt)) return { id: c.id, status: 'stale', errors: null }
        records.set(c.id, { entity: c.entity, id: c.id, version: ++version, payload: c.payload, deletedAt: null, clientUpdatedAt: c.clientUpdatedAt })
        return { id: c.id, status: 'applied', errors: null }
      })
      return json({ results })
    },
    'GET /api/sync/pull': (call) => {
      const since = Number(new URL(call.path, 'http://api.test').searchParams.get('since') ?? 0)
      const page = [...records.values()].filter((r) => r.version > since).sort((a, b) => a.version - b.version)
      return json({ records: page, nextSince: page.at(-1)?.version ?? since, hasMore: false })
    },
  })
  return records
}

describe('questionnaireTemplateRepo', () => {
  it('creates the template once and then updates the same one, queueing { document }', async () => {
    const db = await newLocalDb()
    expect(await questionnaireTemplateRepo.get(db)).toBeNull()

    const id = await questionnaireTemplateRepo.save(db, template, T0)
    const again = await questionnaireTemplateRepo.save(db, { ...template, title: 'Outro título' }, later(1))

    expect(again).toBe(id)
    expect(await questionnaireTemplateRepo.get(db)).toEqual({ id, document: { ...template, title: 'Outro título' } })
    const entries = await outbox.due(db, later(10), 500)
    expect(entries.map((e) => [e.entity, e.id, e.op])).toEqual([
      ['questionnaire_template', id, 'upsert'],
      ['questionnaire_template', id, 'upsert'],
    ])
    expect(JSON.parse(entries[1]!.payload!)).toEqual({ document: { ...template, title: 'Outro título' } })
  })

  it('refuses an invalid template without its text in the message and keeps the current one', async () => {
    const db = await newLocalDb()
    const id = await questionnaireTemplateRepo.save(db, template, T0)
    const broken = { ...template, sections: [{ ...template.sections[0]!, questions: [{ ...template.sections[0]!.questions[0]!, fill: 'foo' }] }] }

    const error = await questionnaireTemplateRepo.save(db, broken as unknown as QuestionnaireTemplate, later(1)).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(RangeError)
    expect((error as Error).message).toBe('Invalid template')
    expect(await questionnaireTemplateRepo.get(db)).toEqual({ id, document: template })
    expect(await outbox.pendingCount(db)).toBe(1)
  })

  it('round-trip: the template saved on one device reaches the other', async () => {
    fakeServer()
    const a = await newLocalDb()
    const b = await newLocalDb()
    const id = await questionnaireTemplateRepo.save(a, template, T0)

    expect((await new SyncEngine(a, newTestApi(), () => later(1000)).runOnce()).rejected).toBe(0)
    await new SyncEngine(b, newTestApi(), () => later(2000)).runOnce()

    expect(await questionnaireTemplateRepo.get(b)).toEqual({ id, document: template })
  })
})
