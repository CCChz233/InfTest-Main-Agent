import { z } from 'zod/v4'
import {
  AlterTaskRequestSchema,
  resolveExecId,
  TerminateTaskRequestSchema,
} from '../schemas/api.js'
import { TaskSessionManager } from '../TaskSessionManager.js'
import { logEvent } from '../observability/logger.js'
import { handleChatStream } from './chatStream.js'
import {
  apiError,
  apiMessage,
  apiSuccess,
  jsonApiResponse,
  sessionToTaskDetail,
} from './apiResponse.js'
import {
  handlePlannerApiStubRequest,
  isPlannerApiStubPath,
} from './plannerApiStub.js'
import { resolveExecIdFromPlanContext } from './plannerApiRealHandler.js'
import {
  handlePlanRevisionStream,
  isPlanRevisionPayload,
  planRevisionInputFromRecord,
} from './planRevisionStream.js'
import { persistUserInstructionFromPayload } from './userInstructionStore.js'
import {
  applyTaskControl,
  executeTaskStartSync,
  getTaskExecutionSessionManager,
} from './taskExecutionService.js'

function readRunnerMode() {
  if (process.env.INFTEST_STATEFUL_RUNNER === '1') return 'stateful' as const
  if (process.env.INFTEST_RUNNER === 'stateful') return 'stateful' as const
  if (process.env.INFTEST_RUNNER === 'query') return 'query' as const
  if (process.env.INFTEST_RUNNER === 'available') return 'available' as const
  if (process.env.INFTEST_RUNNER === 'fake') return 'fake' as const
  return 'stateful' as const
}

function taskNotFoundResponse(taskId: string): Response {
  return jsonApiResponse(
    apiError(
      404,
      `Exec task not found: ${taskId}. Call POST /tasks/alter with START first.`,
    ),
    404,
  )
}

function invalidRequestResponse(
  message: string,
  issues?: z.core.$ZodIssue[],
): Response {
  const detail =
    issues && issues.length > 0
      ? `${message}: ${JSON.stringify(issues)}`
      : message
  return jsonApiResponse(apiError(400, detail), 400)
}

function parseTaskIdFromPath(pathname: string): string | null {
  const match = /^\/tasks\/([^/]+)$/.exec(pathname)
  if (!match?.[1]) return null
  return decodeURIComponent(match[1])
}

const activePayloadStreams = new Set<string>()

async function handleApiPayloadStream(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonApiResponse(apiError(405, 'Method not allowed'), 405)
  }
  let body: unknown = {}
  try {
    const text = await request.text()
    body = text.trim() === '' ? {} : (JSON.parse(text) as unknown)
  } catch {
    return jsonApiResponse(apiError(400, 'Invalid JSON body'), 400)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonApiResponse(apiError(400, 'Invalid payload body'), 400)
  }
  const record = body as Record<string, unknown>
  const requestId =
    (typeof record.request_id === 'string' && record.request_id.trim()) ||
    request.headers.get('x-request-id') ||
    null

  persistUserInstructionFromPayload(record)

  if (isPlanRevisionPayload(record)) {
    const revisionInput = planRevisionInputFromRecord(record, requestId)
    if (!revisionInput) {
      return jsonApiResponse(apiError(400, 'Invalid plan revision payload'), 400)
    }
    return handlePlanRevisionStream(revisionInput)
  }

  if (requestId && activePayloadStreams.has(requestId)) {
    return jsonApiResponse(
      apiError(409, `payload stream already active for request_id ${requestId}`),
      409,
    )
  }
  const execId =
    (typeof record.exec_id === 'string' && record.exec_id.trim()) ||
    (typeof record.task_id === 'string' && record.task_id.trim()) ||
    (typeof record.plan_id === 'string' && record.plan_id.trim()
      ? resolveExecIdFromPlanContext(record.plan_id.trim())
      : null)
  if (!execId) {
    return jsonApiResponse(
      apiError(400, 'exec_id or task_id (or resolvable plan_id) is required'),
      400,
    )
  }
  const userId =
    (typeof record.user_id === 'string' && record.user_id.trim()) || 'payload-user'
  const userInstruction =
    (typeof record.user_instruction === 'string' && record.user_instruction.trim()) ||
    ''
  if (!userInstruction) {
    return jsonApiResponse(apiError(400, 'user_instruction is required'), 400)
  }

  const streamRequest = new Request('http://127.0.0.1/tasks/chat/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      exec_id: execId,
      task_id: execId,
      user_instruction: userInstruction,
    }),
  })
  if (requestId) activePayloadStreams.add(requestId)
  let response: Response
  try {
    response = await handleChatStream(
      streamRequest,
      getTaskExecutionSessionManager(),
    )
  } catch {
    response = new Response(null, { status: 503 })
  }
  if (response.status === 503) {
    const session = getTaskExecutionSessionManager().get(execId)
    const statusText = session?.status ?? 'UNKNOWN'
    const messageId = requestId ?? `${execId}-${Date.now()}`
    const encoder = new TextEncoder()
    const fallbackStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `event: chunk\ndata: ${JSON.stringify({
              code: 0,
              message: 'success',
              data: {
                exec_id: execId,
                task_id: execId,
                chunk: `Fallback payload stream: task ${execId} is ${statusText}. ${userInstruction}`,
                finished: false,
                message_id: messageId,
              },
            })}\n\n`,
          ),
        )
        controller.enqueue(
          encoder.encode(
            `event: chunk\ndata: ${JSON.stringify({
              code: 0,
              message: 'success',
              data: {
                exec_id: execId,
                task_id: execId,
                chunk: '',
                finished: true,
                message_id: messageId,
              },
            })}\n\n`,
          ),
        )
        controller.close()
      },
    })
    if (requestId) activePayloadStreams.delete(requestId)
    return new Response(fallbackStream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    })
  }
  if (!requestId) return response

  if (response.status !== 200) {
    activePayloadStreams.delete(requestId)
    return response
  }
  if (!response.body) {
    activePayloadStreams.delete(requestId)
    return response
  }
  const original = response.body
  const wrapped = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = original.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) controller.enqueue(value)
        }
      } finally {
        activePayloadStreams.delete(requestId)
        controller.close()
      }
    },
  })
  return new Response(wrapped, { status: response.status, headers: response.headers })
}

function taskIdFromQuery(url: URL): string | null {
  const taskId = url.searchParams.get('task_id') ?? url.searchParams.get('exec_id')
  if (!taskId) return null
  const trimmed = taskId.trim()
  return trimmed === '' ? null : trimmed
}

async function handleTasksAlter(request: Request): Promise<Response> {
  const text = await request.text()
  const body = text.trim() === '' ? {} : (JSON.parse(text) as unknown)
  const parsed = AlterTaskRequestSchema.safeParse(body)
  if (!parsed.success) {
    return invalidRequestResponse(
      'Invalid alter task request',
      parsed.error.issues,
    )
  }

  const { task_operation } = parsed.data
  const execId = resolveExecId(parsed.data)

  if (task_operation === 'START') {
    const result = await executeTaskStartSync(execId, readRunnerMode())
    if (result.code === 0 && result.data) {
      return jsonApiResponse(apiSuccess(result.data, result.message))
    }
    if (result.data) {
      return jsonApiResponse(apiError(result.code, result.message), result.httpStatus)
    }
    return jsonApiResponse(apiError(result.code, result.message), result.httpStatus)
  }

  const control = applyTaskControl(execId, task_operation)
  if (control.code === 0) {
    return jsonApiResponse(apiMessage(control.message))
  }
  return jsonApiResponse(apiError(control.code, control.message), control.httpStatus)
}

async function handleTasksTerminate(request: Request): Promise<Response> {
  const text = await request.text()
  const body = text.trim() === '' ? {} : (JSON.parse(text) as unknown)
  const parsed = TerminateTaskRequestSchema.safeParse(body)
  if (!parsed.success) {
    return invalidRequestResponse(
      'Invalid terminate task request',
      parsed.error.issues,
    )
  }

  const execId = resolveExecId(parsed.data)
  const control = applyTaskControl(execId, 'TERMINATE')
  if (control.code === 0) {
    return jsonApiResponse(apiMessage(control.message))
  }
  return jsonApiResponse(apiError(control.code, control.message), control.httpStatus)
}

function handleGetTask(taskId: string): Response {
  const session = getTaskExecutionSessionManager().get(taskId)
  if (!session) {
    return taskNotFoundResponse(taskId)
  }
  return jsonApiResponse(
    apiSuccess({
      task_detail: sessionToTaskDetail(session),
    }),
  )
}

async function dispatchInfTestTaskApiRequest(
  request: Request,
): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/api/payload') {
    return handleApiPayloadStream(request)
  }

  if (isPlannerApiStubPath(url.pathname)) {
    return handlePlannerApiStubRequest(request)
  }

  if (url.pathname === '/health') {
    if (request.method !== 'GET') {
      return jsonApiResponse(apiError(405, 'Method not allowed'), 405)
    }
    return jsonApiResponse(apiSuccess({ status: 'ok' }))
  }

  if (url.pathname === '/tasks/alter') {
    if (request.method !== 'POST') {
      return jsonApiResponse(apiError(405, 'Method not allowed'), 405)
    }
    return handleTasksAlter(request)
  }

  if (url.pathname === '/api/tasks/alter') {
    if (request.method !== 'POST') {
      return jsonApiResponse(apiError(405, 'Method not allowed'), 405)
    }
    return handleTasksAlter(request)
  }

  if (url.pathname === '/tasks/terminate') {
    if (request.method !== 'POST') {
      return jsonApiResponse(apiError(405, 'Method not allowed'), 405)
    }
    return handleTasksTerminate(request)
  }

  if (url.pathname === '/api/tasks/terminate') {
    if (request.method !== 'POST') {
      return jsonApiResponse(apiError(405, 'Method not allowed'), 405)
    }
    return handleTasksTerminate(request)
  }

  if (url.pathname === '/tasks/chat/stream') {
    return handleChatStream(request, getTaskExecutionSessionManager())
  }

  if (url.pathname === '/api/tasks/detail') {
    if (request.method !== 'GET') {
      return jsonApiResponse(apiError(405, 'Method not allowed'), 405)
    }
    const taskId = taskIdFromQuery(url)
    if (!taskId) {
      return jsonApiResponse(apiError(400, 'task_id is required'), 400)
    }
    return handleGetTask(taskId)
  }

  const taskIdFromPath = parseTaskIdFromPath(url.pathname)
  if (taskIdFromPath) {
    if (request.method !== 'GET') {
      return jsonApiResponse(apiError(405, 'Method not allowed'), 405)
    }
    return handleGetTask(taskIdFromPath)
  }

  return jsonApiResponse(apiError(404, 'Not found'), 404)
}

export async function handleInfTestTaskApiRequest(
  request: Request,
): Promise<Response> {
  const startedAt = Date.now()
  const url = new URL(request.url)
  const requestId = request.headers.get('x-request-id')
  try {
    const response = await dispatchInfTestTaskApiRequest(request)
    logEvent('info', 'http.request', {
      request_id: requestId,
      method: request.method,
      path: url.pathname,
      query: url.search,
      status: response.status,
      latency_ms: Date.now() - startedAt,
    })
    return response
  } catch (error) {
    logEvent('error', 'http.request.unhandled_error', {
      request_id: requestId,
      method: request.method,
      path: url.pathname,
      query: url.search,
      latency_ms: Date.now() - startedAt,
      error,
    })
    return jsonApiResponse(apiError(500, 'Internal server error'), 500)
  }
}

function readPort(): number {
  const value = Number(process.env.INFTEST_PORT ?? 8787)
  return Number.isInteger(value) && value > 0 ? value : 8787
}

export type InfTestTaskApiServerOptions = {
  hostname?: string
  port?: number
}

export function startInfTestTaskApiServer(
  options: InfTestTaskApiServerOptions = {},
): ReturnType<typeof Bun.serve> {
  const hostname = options.hostname ?? process.env.INFTEST_HOST ?? '127.0.0.1'
  const port = options.port ?? readPort()
  return Bun.serve({
    hostname,
    port,
    fetch: handleInfTestTaskApiRequest,
  })
}

/** @internal test-only */
export function getInfTestTaskSessionManagerForTests(): TaskSessionManager {
  return getTaskExecutionSessionManager()
}

if (import.meta.main) {
  const server = startInfTestTaskApiServer()
  process.stdout.write(
    `InfTest task API listening on http://${server.hostname}:${server.port}\n`,
  )
}
