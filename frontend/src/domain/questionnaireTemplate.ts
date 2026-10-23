import { z } from 'zod'
import { FILL_METRICS } from './fillMetrics'

/**
 * The update questionnaire template (`questionnaire_template.document`), mirroring the server's validator: camelCase
 * keys, the limits of the data contract. Only the mechanism lives in the repository; the real questions are the user's data.
 */

export const QUESTION_KINDS = ['text', 'long_text', 'number', 'choice'] as const
export type QuestionKind = (typeof QUESTION_KINDS)[number]

export const MAX_QUESTIONS = 300
const QUESTION_KEY = /^[a-z0-9_]{1,64}$/
const POSE_KEY = /^[a-z0-9_]{1,32}$/

/** Trimmed text (the server refuses blank ones: IsNullOrWhiteSpace) of at most `max` characters. */
const text = (max: number) => z.string().trim().min(1).max(max)

const questionSchema = z.object({
  key: z.string().regex(QUESTION_KEY),
  text: text(1000),
  kind: z.enum(QUESTION_KINDS),
  options: z.array(text(120)).nullish(),
  fill: z.enum(FILL_METRICS).nullish(),
})

const sectionSchema = z.object({
  title: text(120),
  questions: z.array(questionSchema).min(1).max(60),
})

const poseSchema = z.object({
  key: z.string().regex(POSE_KEY),
  label: text(40),
})

const DUPLICATE_KEY = 'duplicate_key'
const DUPLICATE_POSE = 'duplicate_pose'

export const questionnaireTemplateSchema = z
  .object({
    title: text(120),
    sections: z.array(sectionSchema).min(1).max(30),
    poses: z.preprocess((v) => v ?? [], z.array(poseSchema).max(12)),
  })
  .superRefine((t, ctx) => {
    const keys = new Set<string>()
    let total = 0
    t.sections.forEach((section, s) =>
      section.questions.forEach((q, i) => {
        total++
        const path = ['sections', s, 'questions', i]
        if (keys.has(q.key)) ctx.addIssue({ code: 'custom', path: [...path, 'key'], message: DUPLICATE_KEY, params: { value: q.key } })
        keys.add(q.key)
        const count = q.options?.length ?? 0
        const optionsOk = q.kind === 'choice' ? count >= 2 && count <= 20 : q.options == null
        if (!optionsOk) ctx.addIssue({ code: 'custom', path: [...path, 'options'], message: 'invalid options' })
      }),
    )
    if (total > MAX_QUESTIONS) ctx.addIssue({ code: 'custom', path: ['sections'], message: 'too many questions' })
    const poses = new Set<string>()
    t.poses.forEach((pose, i) => {
      if (poses.has(pose.key)) ctx.addIssue({ code: 'custom', path: ['poses', i, 'key'], message: DUPLICATE_POSE, params: { value: pose.key } })
      poses.add(pose.key)
    })
  })

export type QuestionnaireTemplate = z.infer<typeof questionnaireTemplateSchema>
export type TemplateSection = QuestionnaireTemplate['sections'][number]
export type TemplateQuestion = TemplateSection['questions'][number]
export interface Pose {
  key: string
  label: string
}

/** The poses used when the template brings none. */
export const DEFAULT_POSES: readonly Pose[] = [
  { key: 'front', label: 'Frente' },
  { key: 'back', label: 'Costas' },
  { key: 'right_side', label: 'Lado direito' },
  { key: 'left_side', label: 'Lado esquerdo' },
  { key: 'abs', label: 'Abdômen' },
]

export function posesOf(t: QuestionnaireTemplate | null): Pose[] {
  return t && t.poses.length > 0 ? t.poses.map((p) => ({ ...p })) : DEFAULT_POSES.map((p) => ({ ...p }))
}

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let current = root
  for (const part of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<PropertyKey, unknown>)[part]
  }
  return current
}

export type TemplateParseResult = { ok: true; value: QuestionnaireTemplate } | { ok: false; message: string }

/** Reads an imported template file. The message (pt-BR) names a key or metric at most, never a question's text. */
export function parseTemplateJson(text: string): TemplateParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, message: 'Arquivo não é um JSON válido.' }
  }
  const result = questionnaireTemplateSchema.safeParse(raw)
  if (result.success) return { ok: true, value: result.data }

  const issues = result.error.issues
  const fill = issues.find((i) => i.path.at(-1) === 'fill')
  if (fill) return { ok: false, message: `Métrica desconhecida: ${String(valueAt(raw, fill.path))}` }
  const duplicate = issues.find((i) => i.message === DUPLICATE_KEY || i.message === DUPLICATE_POSE)
  if (duplicate) {
    const value = String(valueAt(raw, duplicate.path))
    return { ok: false, message: duplicate.message === DUPLICATE_KEY ? `Chave repetida: ${value}` : `Pose repetida: ${value}` }
  }
  const path = issues[0]?.path.join('.') ?? ''
  return { ok: false, message: path ? `Modelo inválido em ${path}.` : 'Modelo inválido.' }
}
