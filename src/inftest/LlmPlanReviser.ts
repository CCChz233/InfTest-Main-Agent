import type { PlanDetailInfo } from './adapters/ProxyClient.js'
import type { PlanQaEntry } from './server/planContextArtifacts.js'

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return text.slice(start, end + 1)
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizePlanDetail(record: Record<string, unknown>): PlanDetailInfo {
  return {
    test_objectives: stringValue(record.test_objectives),
    test_scope: stringValue(record.test_scope),
    test_target: stringValue(record.test_target),
    test_environment: stringValue(record.test_environment),
    resources: stringValue(record.resources),
    schedule: stringValue(record.schedule),
    deliverables: stringValue(record.deliverables),
  }
}

export type RevisePlanWithLlmInput = {
  plan_id: string
  user_instruction: string
  current_plan_detail: PlanDetailInfo
  plan_qa_list?: PlanQaEntry[]
  remark?: string | null
}

export type RevisePlanWithLlmResult = {
  plan_detail: PlanDetailInfo
  summary_markdown: string
}

export async function revisePlanWithLlm(
  input: RevisePlanWithLlmInput,
): Promise<RevisePlanWithLlmResult | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) return null

  const baseUrl =
    process.env.OPENAI_BASE_URL?.trim() ??
    process.env.BASE_URL?.trim() ??
    'https://api.openai.com/v1'
  const model =
    process.env.INFTEST_MODEL?.trim() ??
    process.env.OPENAI_MODEL?.trim() ??
    'gpt-4o-mini'

  const qaBlock =
    input.plan_qa_list && input.plan_qa_list.length > 0
      ? input.plan_qa_list
          .map(
            (qa, i) =>
              `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`,
          )
          .join('\n\n')
      : ''

  const prompt = [
    'You are an InfTest planning assistant revising a test plan.',
    'Apply the user instruction to update the plan. Keep all seven sections.',
    'Return JSON only with keys: plan_detail, revision_summary.',
    'plan_detail must include exactly: test_objectives, test_scope, test_target,',
    'test_environment, resources, schedule, deliverables (all strings).',
    'revision_summary is a short markdown paragraph describing what changed (Chinese OK).',
    `plan_id=${input.plan_id}`,
    `user_instruction=${input.user_instruction}`,
    input.remark ? `remark=${input.remark}` : '',
    `current_plan_detail=${JSON.stringify(input.current_plan_detail)}`,
    qaBlock ? `plan_qa_history=\n${qaBlock}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: 'Return JSON only. No markdown fence.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  })

  if (!response.ok) return null
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const raw = body.choices?.[0]?.message?.content
  if (!raw || typeof raw !== 'string') return null
  const jsonText = extractJsonObject(raw)
  if (!jsonText) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const detailRaw =
    record.plan_detail &&
    typeof record.plan_detail === 'object' &&
    !Array.isArray(record.plan_detail)
      ? (record.plan_detail as Record<string, unknown>)
      : record
  const plan_detail = normalizePlanDetail(detailRaw)
  const summary_markdown = stringValue(
    record.revision_summary,
    '测试计划已根据用户指令更新。',
  )
  return { plan_detail, summary_markdown }
}

/** Split revision summary into SSE-sized chunks. */
export function chunkRevisionText(text: string, chunkSize = 120): string[] {
  const normalized = text.trim()
  if (!normalized) return ['']
  const chunks: string[] = []
  for (let i = 0; i < normalized.length; i += chunkSize) {
    chunks.push(normalized.slice(i, i + chunkSize))
  }
  return chunks
}
