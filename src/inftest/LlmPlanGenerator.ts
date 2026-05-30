type LlmGeneratedTask = {
  task_name: string
  task_type: string
}

type LlmPlanOutput = {
  plan_detail: Record<string, unknown>
  tasks: LlmGeneratedTask[]
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return text.slice(start, end + 1)
}

function normalizeTaskType(type: string): string {
  const upper = type.trim().toUpperCase()
  if (upper === 'FUNCTIONAL' || upper === 'INTEGRATION' || upper === 'SMOKE') {
    return upper
  }
  return 'FUNCTIONAL'
}

export async function generatePlanWithLlm(input: {
  plan_id: string
  plan_name?: string | null
  project_id?: string | null
  test_env_url?: string | null
  prd_file_key?: string | null
  prd_content?: string | null
  remark?: string | null
  test_strategies: string[]
  runner_mode: string
}): Promise<LlmPlanOutput | null> {
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

  const prompt = [
    'You are an InfTest planning assistant.',
    `Runner mode: ${input.runner_mode}.`,
    'Generate compact JSON only with keys: plan_detail, tasks.',
    'plan_detail must include exactly these string keys:',
    'test_objectives, test_scope, test_target, test_environment, resources, schedule, deliverables.',
    'tasks must be an array of objects: {task_name, task_type}.',
    'task_type must be FUNCTIONAL/INTEGRATION/SMOKE.',
    `plan_id=${input.plan_id}`,
    `plan_name=${input.plan_name ?? ''}`,
    `project_id=${input.project_id ?? ''}`,
    `test_env_url=${input.test_env_url ?? ''}`,
    `prd_file_key=${input.prd_file_key ?? ''}`,
    input.prd_content
      ? `prd_content=\n${input.prd_content.slice(0, 80_000)}`
      : '',
    input.remark ? `remark=${input.remark}` : '',
    `test_strategies=${JSON.stringify(input.test_strategies)}`,
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
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'Return JSON only. No markdown fence.',
        },
        {
          role: 'user',
          content: prompt,
        },
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
  const planDetail =
    record.plan_detail && typeof record.plan_detail === 'object' && !Array.isArray(record.plan_detail)
      ? (record.plan_detail as Record<string, unknown>)
      : {}
  const tasksRaw = Array.isArray(record.tasks) ? record.tasks : []
  const tasks = tasksRaw
    .filter(task => task && typeof task === 'object' && !Array.isArray(task))
    .map(task => {
      const obj = task as Record<string, unknown>
      return {
        task_name:
          (typeof obj.task_name === 'string' && obj.task_name.trim()) ||
          'Generated task',
        task_type: normalizeTaskType(
          typeof obj.task_type === 'string' ? obj.task_type : 'FUNCTIONAL',
        ),
      }
    })
  if (tasks.length === 0) return null
  return { plan_detail: planDetail, tasks }
}
