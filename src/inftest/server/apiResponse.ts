import { buildTaskMessage } from '../TaskSessionManager.js'
import type { TaskSession } from '../schemas/session.js'
import { TaskDetailSchema, type TaskDetail } from '../schemas/api.js'

export const API_CODE_SUCCESS = 0

export type ApiSuccess<T> = {
  code: number
  message: string
  data: T
}

export type ApiMessageOnly = {
  code: number
  message: string
}

export function apiSuccess<T>(data: T, message = 'success'): ApiSuccess<T> {
  return { code: API_CODE_SUCCESS, message, data }
}

export function apiMessage(message: string): ApiMessageOnly {
  return { code: API_CODE_SUCCESS, message }
}

export function apiError(
  code: number,
  message: string,
): { code: number; message: string } {
  return { code, message }
}

export function sessionToTaskDetail(session: TaskSession): TaskDetail {
  return TaskDetailSchema.parse({
    task_id: session.task_id,
    task_status: session.status,
    workspace: session.workspace,
    runner: session.runner,
    started_at: session.started_at,
    finished_at: session.finished_at,
    last_error: session.last_error,
    run_fake_e2e_invoked: session.run_fake_e2e_invoked,
    artifacts: session.artifacts,
    message: buildTaskMessage(session),
  })
}

export function httpStatusForApiCode(code: number): number {
  if (code === API_CODE_SUCCESS) return 200
  if (code >= 400 && code < 600) return code
  return 500
}

export function jsonApiResponse(
  body: { code: number; message: string; data?: unknown },
  httpStatus?: number,
): Response {
  const status = httpStatus ?? httpStatusForApiCode(body.code)
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  })
}
