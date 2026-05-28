type ApiEnvelope<T = unknown> = {
  code: number
  message: string
  data?: T
}

type TaskStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'PAUSED'
  | 'SUCCESS'
  | 'FAILED'
  | 'TERMINATED'

type TaskRecord = {
  task_id: string
  task_name: string
  task_status: TaskStatus
  task_target: string
  task_config: {
    enable_case_generation: boolean
    enable_device_manager: boolean
    enable_test_execution: boolean
    enable_result_analysis: boolean
  }
  created_time: string
  updated_time: string
  started_time: string | null
  ended_time: string | null
  report_file_key: string
  task_log: string
  updates: unknown[]
  uploads: Array<{
    file_key: string
    file_name: string
    file_size: number
    bucket: string
  }>
}

const tasks = new Map<string, TaskRecord>()

function now(): string {
  return new Date().toISOString()
}

function json<T>(payload: ApiEnvelope<T>, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  })
}

function error(message: string, status = 400): Response {
  return json({ code: status, message }, status)
}

function readPort(): number {
  const value = Number(process.env.INFTEST_MOCK_BACKEND_PORT ?? 8790)
  return Number.isInteger(value) && value > 0 ? value : 8790
}

function readHost(): string {
  return process.env.INFTEST_MOCK_BACKEND_HOST ?? '127.0.0.1'
}

function readAgentBaseUrl(): string {
  return process.env.INFTEST_AGENT_BASE_URL ?? 'http://127.0.0.1:8787'
}

function defaultTaskTarget(taskId: string): string {
  return `用户从 mock 后端启动 InfTest 任务 ${taskId}，请生成测试计划、调用子 Agent 并上报任务进度。`
}

function ensureTask(taskId: string, patch: Partial<TaskRecord> = {}): TaskRecord {
  const existing = tasks.get(taskId)
  if (existing) {
    Object.assign(existing, patch, { updated_time: now() })
    return existing
  }
  const timestamp = now()
  const task: TaskRecord = {
    task_id: taskId,
    task_name: `Mock InfTest Task ${taskId}`,
    task_status: 'PENDING',
    task_target: defaultTaskTarget(taskId),
    task_config: {
      enable_case_generation: true,
      enable_device_manager: true,
      enable_test_execution: true,
      enable_result_analysis: true,
    },
    created_time: timestamp,
    updated_time: timestamp,
    started_time: null,
    ended_time: null,
    report_file_key: '',
    task_log: '',
    updates: [],
    uploads: [],
    ...patch,
  }
  tasks.set(taskId, task)
  return task
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (!text.trim()) return {}
  const parsed = JSON.parse(text) as unknown
  return typeof parsed === 'object' && parsed !== null
    ? (parsed as Record<string, unknown>)
    : {}
}

function taskDetailPayload(task: TaskRecord): Record<string, unknown> {
  return {
    id: 1,
    task_id: task.task_id,
    task_name: task.task_name,
    task_status: task.task_status,
    total_tokens: 0,
    report_file_key: task.report_file_key,
    project_id: 'xh',
    project_name: '新华',
    plan_id: 'plan-mock-001',
    plan_name: 'Mock 后端端口联调计划',
    user_id: 1,
    user_name: 'mock-user',
    created_time: task.created_time,
    updated_time: task.updated_time,
    case_list: [],
    case_num: 0,
    failed_num: 0,
    pass_num: 0,
    task_log: task.task_log,
    defect_num: 0,
  }
}

function proxyTaskDetailPayload(task: TaskRecord): Record<string, unknown> {
  return {
    task_id: task.task_id,
    task_target: task.task_target,
    task_config: task.task_config,
  }
}

async function callAgent(path: string, init: RequestInit): Promise<unknown> {
  const base = readAgentBaseUrl().replace(/\/$/, '')
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  let body: unknown = text
  try {
    body = JSON.parse(text) as unknown
  } catch {
    /* keep raw text */
  }
  if (!response.ok) {
    throw new Error(`Agent ${path} failed: ${response.status} ${text.slice(0, 500)}`)
  }
  return body
}

function updateTaskFromAgentResponse(task: TaskRecord, body: unknown): void {
  const payload =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {}
  const data =
    typeof payload.data === 'object' && payload.data !== null
      ? (payload.data as Record<string, unknown>)
      : {}
  const status = data.task_status
  if (
    status === 'SUCCESS' ||
    status === 'FAILED' ||
    status === 'RUNNING' ||
    status === 'PAUSED' ||
    status === 'TERMINATED'
  ) {
    task.task_status = status
  }
  const artifacts =
    typeof data.artifacts === 'object' && data.artifacts !== null
      ? (data.artifacts as Record<string, unknown>)
      : {}
  if (typeof artifacts.analysis_report === 'string') {
    task.report_file_key = artifacts.analysis_report
  }
  task.task_log = typeof payload.message === 'string' ? payload.message : task.task_log
  task.updated_time = now()
  if (task.task_status === 'SUCCESS' || task.task_status === 'FAILED') {
    task.ended_time = task.updated_time
  }
}

async function handleAlter(request: Request): Promise<Response> {
  const body = await readJson(request)
  const taskId = String(body.task_id ?? '').trim()
  const operation = String(body.task_operation ?? '').trim().toUpperCase()
  if (!taskId) return error('task_id is required')
  if (!operation) return error('task_operation is required')

  const patch: Partial<TaskRecord> = {}
  if (typeof body.task_target === 'string' && body.task_target.trim()) {
    patch.task_target = body.task_target.trim()
  }
  const task = ensureTask(taskId, patch)

  if (operation === 'START' || operation === 'RESTART') {
    task.task_status = 'RUNNING'
    task.started_time = now()
    task.ended_time = null
    const agentBody = await callAgent('/tasks/alter', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        task_id: taskId,
        task_operation: 'START',
      }),
    })
    updateTaskFromAgentResponse(task, agentBody)
    return json({
      code: 0,
      message: 'success',
      data: {
        task_id: taskId,
        task_status: task.task_status,
        agent_response: agentBody,
      },
    })
  }

  if (operation === 'PAUSE' || operation === 'CONTINUE') {
    const agentBody = await callAgent('/tasks/alter', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        task_id: taskId,
        task_operation: operation,
      }),
    })
    task.task_status = operation === 'PAUSE' ? 'PAUSED' : 'RUNNING'
    task.updated_time = now()
    return json({
      code: 0,
      message: 'success',
      data: {
        task_id: taskId,
        task_status: task.task_status,
        agent_response: agentBody,
      },
    })
  }

  if (operation === 'TERMINATION' || operation === 'TERMINATE') {
    const agentBody = await callAgent('/tasks/terminate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task_id: taskId }),
    })
    task.task_status = 'TERMINATED'
    task.ended_time = now()
    task.updated_time = task.ended_time
    return json({
      code: 0,
      message: 'success',
      data: {
        task_id: taskId,
        task_status: task.task_status,
        agent_response: agentBody,
      },
    })
  }

  return error(`Unsupported task_operation: ${operation}`)
}

async function handleUpdate(request: Request): Promise<Response> {
  const body = await readJson(request)
  const taskId = String(body.task_id ?? '').trim()
  if (!taskId) return error('task_id is required')
  const task = ensureTask(taskId)
  task.updates.push(body)
  if (typeof body.step_log === 'string') {
    task.task_log = body.step_log
  }
  if (typeof body.message === 'string') {
    task.task_log = body.message
  }
  const status = body.task_status
  if (
    status === 'PENDING' ||
    status === 'RUNNING' ||
    status === 'PAUSED' ||
    status === 'SUCCESS' ||
    status === 'FAILED' ||
    status === 'TERMINATED'
  ) {
    task.task_status = status
    if (status === 'SUCCESS' || status === 'FAILED' || status === 'TERMINATED') {
      task.ended_time = now()
    }
  }
  task.updated_time = now()
  return json({
    code: 0,
    message: 'success',
    data: {
      accepted: true,
      event_id: typeof body.event_id === 'string' ? body.event_id : '',
      task_id: taskId,
      update_count: task.updates.length,
    },
  })
}

async function handleUpload(request: Request): Promise<Response> {
  const form = await request.formData()
  const file = form.get('file')
  const providedName = form.get('file_name')
  const fileName =
    typeof providedName === 'string' && providedName.trim()
      ? providedName.trim()
      : file instanceof File
      ? file.name
      : `agent-upload-${Date.now()}`
  const fileSize = file instanceof File ? file.size : 0
  const uploaded = {
    file_key: `/mock-oss/${fileName}`,
    file_name: fileName,
    file_size: fileSize,
    bucket: 'mock-inftest',
  }
  const taskIdValue = form.get('task_id')
  if (typeof taskIdValue === 'string' && taskIdValue.trim()) {
    ensureTask(taskIdValue.trim()).uploads.push(uploaded)
  }
  return json({
    code: 0,
    message: 'success',
    data: uploaded,
  })
}

function getTaskIdFromDetailUrl(url: URL): string {
  return (
    url.searchParams.get('task_id') ??
    url.searchParams.get('id') ??
    ''
  ).trim()
}

export async function handleInfTestMockBackendRequest(
  request: Request,
): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  if (path === '/health' || path === '/api/health') {
    return json({
      code: 0,
      message: 'success',
      data: { status: 'ok', service: 'inftest-mock-backend' },
    })
  }

  if (path === '/api/tasks/alter' && request.method === 'POST') {
    return handleAlter(request)
  }

  if (
    (path === '/api/tasks/update' || path === '/api/inftest/task_report') &&
    request.method === 'POST'
  ) {
    return handleUpdate(request)
  }

  if (path === '/api/files/agent/upload' && request.method === 'POST') {
    return handleUpload(request)
  }

  if (path === '/api/tasks/detail' && request.method === 'GET') {
    const taskId = getTaskIdFromDetailUrl(url)
    if (!taskId) return error('task_id is required')
    const task = ensureTask(taskId)
    return json({
      code: 0,
      message: 'success',
      data: {
        task_detail: proxyTaskDetailPayload(task),
        backend_task_detail: taskDetailPayload(task),
      },
    })
  }

  const proxyTaskMatch = /^\/tasks\/([^/]+)$/.exec(path)
  if (proxyTaskMatch?.[1] && request.method === 'GET') {
    const task = ensureTask(decodeURIComponent(proxyTaskMatch[1]))
    return json({
      code: 0,
      message: 'success',
      data: {
        task_detail: proxyTaskDetailPayload(task),
      },
    })
  }

  const mockTaskMatch = /^\/api\/mock\/tasks\/([^/]+)$/.exec(path)
  if (mockTaskMatch?.[1] && request.method === 'GET') {
    const task = ensureTask(decodeURIComponent(mockTaskMatch[1]))
    return json({
      code: 0,
      message: 'success',
      data: task,
    })
  }

  return error(`Not found: ${path}`, 404)
}

export function startInfTestMockBackendApiServer(): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: readHost(),
    port: readPort(),
    fetch: handleInfTestMockBackendRequest,
  })
}

if (import.meta.main) {
  const server = startInfTestMockBackendApiServer()
  process.stdout.write(
    `InfTest mock backend API listening on http://${server.hostname}:${server.port}\n`,
  )
  process.stdout.write(`Forwarding START requests to ${readAgentBaseUrl()}\n`)
}
