import { access } from 'fs/promises'
import { bootstrapInfTestHeadless } from '../src/inftest/headlessBootstrap.js'
import { DEFAULT_INFTEST_FAKE_TASK_ID } from '../src/inftest/FakeE2ERunner.js'
import type { StartTaskData } from '../src/inftest/schemas/api.js'
import type { TaskDetail } from '../src/inftest/schemas/api.js'
import {
  handleInfTestTaskApiRequest,
  startInfTestTaskApiServer,
} from '../src/inftest/server/taskApi.js'
import { TaskSessionManager } from '../src/inftest/TaskSessionManager.js'

/** Maps user-facing names to FakeE2ERunner artifact keys */
export const REQUIRED_ARTIFACT_KEYS = [
  'plan',
  'test_cases',
  'device_bindings',
  'execution_summary',
  'analysis_report',
] as const

type ApiEnvelope<T> = {
  code: number
  message: string
  data?: T
}

export type ApiE2EStartResult = StartTaskData
export type ApiE2EGetResult = TaskDetail

export type ApiE2EOptions = {
  runner: 'fake' | 'query'
  taskId?: string
  /** When true, bind a real HTTP server (default). */
  useHttpServer?: boolean
  port?: number
}

function fail(message: string): never {
  throw new Error(message)
}

function unwrap<T>(body: ApiEnvelope<T>, context: string): T {
  if (body.code !== 0 || body.data === undefined) {
    fail(`${context}: expected code=0 with data, got ${JSON.stringify(body)}`)
  }
  return body.data
}

export async function assertRequiredArtifacts(
  artifacts: Record<string, string>,
): Promise<void> {
  for (const key of REQUIRED_ARTIFACT_KEYS) {
    const filePath = artifacts[key]
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      fail(`missing artifacts.${key}`)
    }
    try {
      await access(filePath)
    } catch {
      fail(`artifact file not found for ${key}: ${filePath}`)
    }
  }
}

async function apiFetch(
  baseUrl: string,
  path: string,
  init: RequestInit,
): Promise<Response> {
  if (baseUrl === 'handler:') {
    return handleInfTestTaskApiRequest(
      new Request(`http://127.0.0.1${path}`, init),
    )
  }
  return fetch(`${baseUrl}${path}`, init)
}

export async function runInfTestApiE2E(
  options: ApiE2EOptions,
): Promise<{ start: ApiE2EStartResult; get: ApiE2EGetResult }> {
  bootstrapInfTestHeadless()
  TaskSessionManager.clearAll()

  const taskId = options.taskId ?? DEFAULT_INFTEST_FAKE_TASK_ID
  const previousRunner = process.env.INFTEST_RUNNER
  if (options.runner === 'query') {
    process.env.INFTEST_RUNNER = 'query'
  } else {
    delete process.env.INFTEST_RUNNER
  }

  const port = options.port ?? Number(process.env.INFTEST_E2E_PORT ?? 18787)
  const useHttpServer = options.useHttpServer !== false
  let server: ReturnType<typeof startInfTestTaskApiServer> | undefined
  const baseUrl = useHttpServer
    ? (() => {
        server = startInfTestTaskApiServer({
          hostname: '127.0.0.1',
          port,
        })
        return `http://127.0.0.1:${port}`
      })()
    : 'handler:'

  try {
    const startResponse = await apiFetch(baseUrl, '/tasks/alter', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        task_id: taskId,
        task_operation: 'START',
      }),
    })

    if (startResponse.status !== 200) {
      const text = await startResponse.text()
      fail(
        `POST /tasks/alter START expected 200, got ${startResponse.status}: ${text}`,
      )
    }

    const startEnvelope = (await startResponse.json()) as ApiEnvelope<StartTaskData>
    const start = unwrap(startEnvelope, 'POST /tasks/alter START')
    if (start.task_status !== 'SUCCESS') {
      fail(
        `POST /tasks/alter START expected task_status SUCCESS, got ${start.task_status}`,
      )
    }
    if (start.runner !== options.runner) {
      fail(`expected runner ${options.runner}, got ${start.runner}`)
    }
    if (!start.workspace) {
      fail('missing workspace in START response data')
    }

    await assertRequiredArtifacts(start.artifacts)

    const getResponse = await apiFetch(
      baseUrl,
      `/tasks/${encodeURIComponent(taskId)}`,
      { method: 'GET' },
    )
    if (getResponse.status !== 200) {
      const text = await getResponse.text()
      fail(`GET /tasks/:id expected 200, got ${getResponse.status}: ${text}`)
    }

    const getEnvelope = (await getResponse.json()) as ApiEnvelope<{
      task_detail: TaskDetail
    }>
    const getData = unwrap(getEnvelope, 'GET /tasks/:id')
    const get = getData.task_detail
    if (get.task_status !== 'SUCCESS') {
      fail(`GET /tasks/:id expected task_status SUCCESS, got ${get.task_status}`)
    }

    return { start, get }
  } finally {
    server?.stop()
    if (previousRunner === undefined) {
      delete process.env.INFTEST_RUNNER
    } else {
      process.env.INFTEST_RUNNER = previousRunner
    }
  }
}
