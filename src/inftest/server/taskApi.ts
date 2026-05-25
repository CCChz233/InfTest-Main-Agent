import { z } from 'zod/v4'
import {
  DEFAULT_INFTEST_FAKE_TASK_ID,
  runInfTestFakeE2E,
} from '../FakeE2ERunner.js'
import { InfTestQueryRunner } from '../InfTestQueryRunner.js'
import { InfTestStepwiseQueryRunner } from '../InfTestStepwiseQueryRunner.js'
import { bootstrapInfTestHeadless } from '../headlessBootstrap.js'
import {
  AlterTaskRequestSchema,
  TerminateTaskRequestSchema,
  type StartTaskData,
} from '../schemas/api.js'
import type { InfTestFakeE2EStep } from '../FakeE2ERunner.js'
import type { InfTestRunnerMode, TaskSession } from '../schemas/session.js'
import { handleChatStream } from './chatStream.js'
import {
  apiError,
  apiMessage,
  apiSuccess,
  jsonApiResponse,
  sessionToTaskDetail,
} from './apiResponse.js'
import {
  buildTaskMessage,
  finishSessionFromFakeResult,
  finishSessionFromQueryResult,
  TaskSessionManager,
  TaskSessionNotFoundError,
  toTaskResponse,
} from '../TaskSessionManager.js'
import { registerInfTestSessionManager } from '../taskSessionRegistry.js'

const taskSessionManager = new TaskSessionManager()
registerInfTestSessionManager(taskSessionManager)

export type InfTestTaskApiServerOptions = {
  hostname?: string
  port?: number
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.trim() === '') return {}
  return JSON.parse(text) as unknown
}

function readRunnerMode(): InfTestRunnerMode {
  return process.env.INFTEST_RUNNER === 'query' ? 'query' : 'fake'
}

function readOrchestration(): 'aggregate' | 'stepwise' {
  return process.env.INFTEST_ORCHESTRATION === 'stepwise'
    ? 'stepwise'
    : 'aggregate'
}

function parseTaskIdFromPath(pathname: string): string | null {
  const match = /^\/tasks\/([^/]+)$/.exec(pathname)
  if (!match?.[1]) return null
  return decodeURIComponent(match[1])
}

function taskNotFoundResponse(taskId: string): Response {
  return jsonApiResponse(
    apiError(
      404,
      `Task not found: ${taskId}. Call POST /tasks/alter with START first.`,
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

function startDataFromSession(
  session: TaskSession,
  extra?: Partial<StartTaskData>,
): StartTaskData {
  const response = toTaskResponse(session)
  return {
    task_id: response.task_id,
    task_status: response.status,
    workspace: response.workspace,
    runner: response.runner,
    artifacts: response.artifacts,
    run_fake_e2e_invoked: session.run_fake_e2e_invoked,
    ...extra,
  }
}

async function handleTaskStart(
  taskId: string,
  runner: InfTestRunnerMode,
): Promise<Response> {
  bootstrapInfTestHeadless()
  taskSessionManager.start(taskId, runner)

  if (runner === 'query') {
    const orchestration = readOrchestration()
    const controller = taskSessionManager.beginQueryAbortScope(taskId)
    try {
      const queryResult =
        orchestration === 'stepwise'
          ? await new InfTestStepwiseQueryRunner({
              abortController: controller,
            }).runTask(taskId)
          : await new InfTestQueryRunner({
              abortController: controller,
            }).runTask(taskId)
      const session = finishSessionFromQueryResult(
        taskSessionManager,
        taskId,
        queryResult,
      )
      const steps =
        queryResult.tool_result?.steps?.map((s: InfTestFakeE2EStep) => ({
          name: s.name,
          status: s.status,
          duration_ms: s.duration_ms,
          message: s.message,
        })) ?? []
      const data = startDataFromSession(session, {
        orchestration: queryResult.orchestration ?? orchestration,
        steps: orchestration === 'aggregate' ? steps : steps.length > 0 ? steps : [],
      })
      const message =
        queryResult.final_model_reply && session.status === 'SUCCESS'
          ? queryResult.final_model_reply
          : buildTaskMessage(session)
      if (session.status === 'SUCCESS') {
        return jsonApiResponse(apiSuccess(data, message))
      }
      return jsonApiResponse(apiError(500, message), 500)
    } finally {
      taskSessionManager.endQueryAbortScope(taskId)
    }
  }

  const fakeResult = await runInfTestFakeE2E({ task_id: taskId })
  const session = finishSessionFromFakeResult(
    taskSessionManager,
    taskId,
    fakeResult,
  )
  const data = startDataFromSession(session, {
    orchestration: 'aggregate',
    steps: fakeResult.steps.map(s => ({
      name: s.name,
      status: s.status,
      duration_ms: s.duration_ms,
      message: s.message,
    })),
  })
  const message = buildTaskMessage(session)
  if (session.status === 'SUCCESS') {
    return jsonApiResponse(apiSuccess(data, message))
  }
  return jsonApiResponse(apiError(500, message), 500)
}

function handleGetTask(taskId: string): Response {
  const session = taskSessionManager.get(taskId)
  if (!session) {
    return taskNotFoundResponse(taskId)
  }
  return jsonApiResponse(
    apiSuccess({
      task_detail: sessionToTaskDetail(session),
    }),
  )
}

async function handleTasksAlter(request: Request): Promise<Response> {
  const parsed = AlterTaskRequestSchema.safeParse(await readJson(request))
  if (!parsed.success) {
    return invalidRequestResponse(
      'Invalid alter task request',
      parsed.error.issues,
    )
  }

  const { task_id, task_operation } = parsed.data

  if (task_operation === 'START') {
    return handleTaskStart(task_id, readRunnerMode())
  }

  try {
    taskSessionManager.applyControl(task_id, task_operation)
    const messages: Record<'PAUSE' | 'CONTINUE', string> = {
      PAUSE: 'Task paused',
      CONTINUE: 'Task continued',
    }
    return jsonApiResponse(apiMessage(messages[task_operation]))
  } catch (error) {
    if (error instanceof TaskSessionNotFoundError) {
      return taskNotFoundResponse(error.taskId)
    }
    throw error
  }
}

async function handleTasksTerminate(request: Request): Promise<Response> {
  const parsed = TerminateTaskRequestSchema.safeParse(await readJson(request))
  if (!parsed.success) {
    return invalidRequestResponse(
      'Invalid terminate task request',
      parsed.error.issues,
    )
  }

  const { task_id } = parsed.data

  try {
    taskSessionManager.applyControl(task_id, 'TERMINATE')
    return jsonApiResponse(apiMessage('Task terminated'))
  } catch (error) {
    if (error instanceof TaskSessionNotFoundError) {
      return taskNotFoundResponse(error.taskId)
    }
    throw error
  }
}

export async function handleInfTestTaskApiRequest(
  request: Request,
): Promise<Response> {
  const url = new URL(request.url)

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

  if (url.pathname === '/tasks/terminate') {
    if (request.method !== 'POST') {
      return jsonApiResponse(apiError(405, 'Method not allowed'), 405)
    }
    return handleTasksTerminate(request)
  }

  if (url.pathname === '/tasks/chat/stream') {
    return handleChatStream(request, taskSessionManager)
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

function readPort(): number {
  const value = Number(process.env.INFTEST_PORT ?? 8787)
  return Number.isInteger(value) && value > 0 ? value : 8787
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
  return taskSessionManager
}

if (import.meta.main) {
  const server = startInfTestTaskApiServer()
  process.stdout.write(
    `InfTest task API listening on http://${server.hostname}:${server.port}\n`,
  )
}
