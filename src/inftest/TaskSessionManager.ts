import { WorkspaceManager } from './adapters/WorkspaceManager.js'
import {
  getRunningSubAgentKeys,
  terminateRunningSubAgents,
} from './adapters/SubAgentAdapter.js'
import type { InfTestFakeE2EResult } from './FakeE2ERunner.js'
import type { InfTestQueryRunnerResult } from './InfTestQueryRunner.js'
import type {
  InfTestRunnerMode,
  InfTestTaskResponse,
  InfTestTaskSessionView,
  TaskSession,
} from './schemas/session.js'
import type { TaskOperation, TaskStatus } from './schemas/task.js'

const sessions = new Map<string, TaskSession>()

const queryAbortControllers = new Map<string, AbortController>()

function resolveWorkspace(taskId: string, workspace?: string): string {
  return workspace ?? new WorkspaceManager().getTaskWorkspace(taskId)
}

export function buildTaskMessage(session: TaskSession): string {
  if (session.last_error && session.status === 'FAILED') {
    return session.last_error
  }
  switch (session.status) {
    case 'SUCCESS': {
      const artifactCount = Object.keys(session.artifacts).length
      const invoked = session.run_fake_e2e_invoked
        ? 'run_fake_e2e was invoked'
        : 'deterministic fake workflow completed'
      return `InfTest task ${session.task_id} completed successfully (${session.runner} runner, ${invoked}, ${artifactCount} artifacts).`
    }
    case 'FAILED':
      return (
        session.last_error ??
        `InfTest task ${session.task_id} failed (${session.runner} runner).`
      )
    case 'PAUSED':
      return `InfTest task ${session.task_id} is paused.`
    case 'RUNNING':
      return `InfTest task ${session.task_id} is running.`
    case 'TERMINATED':
      return `InfTest task ${session.task_id} was terminated.`
    case 'PENDING':
      return `InfTest task ${session.task_id} is pending.`
    default:
      return `InfTest task ${session.task_id} status: ${session.status}.`
  }
}

export function toTaskSessionView(session: TaskSession): InfTestTaskSessionView {
  return {
    task_id: session.task_id,
    runner: session.runner,
    status: session.status,
    workspace: session.workspace,
    started_at: session.started_at,
    finished_at: session.finished_at,
    last_error: session.last_error,
    run_fake_e2e_invoked: session.run_fake_e2e_invoked,
    artifacts: session.artifacts,
    message: buildTaskMessage(session),
  }
}

export function toTaskResponse(session: TaskSession): InfTestTaskResponse {
  const terminalStatus =
    session.status === 'SUCCESS' ? 'SUCCESS' : ('FAILED' as const)
  return {
    task_id: session.task_id,
    runner: session.runner,
    status: terminalStatus,
    workspace: session.workspace,
    artifacts: session.artifacts,
    message: buildTaskMessage(session),
  }
}

export class TaskSessionManager {
  start(taskId: string, runner: InfTestRunnerMode): TaskSession {
    const session: TaskSession = {
      task_id: taskId,
      runner,
      status: 'RUNNING',
      workspace: resolveWorkspace(taskId),
      started_at: new Date().toISOString(),
      finished_at: null,
      last_error: null,
      run_fake_e2e_invoked: false,
      artifacts: {},
    }
    sessions.set(taskId, session)
    return session
  }

  finish(
    taskId: string,
    update: {
      status: Extract<TaskStatus, 'SUCCESS' | 'FAILED'>
      workspace?: string
      artifacts?: Record<string, string>
      last_error?: string | null
      run_fake_e2e_invoked?: boolean
    },
  ): TaskSession {
    const existing = sessions.get(taskId)
    if (!existing) {
      throw new Error(`No task session for ${taskId}`)
    }
    const session: TaskSession = {
      ...existing,
      status: update.status,
      workspace: update.workspace ?? existing.workspace,
      finished_at: new Date().toISOString(),
      last_error: update.last_error ?? null,
      run_fake_e2e_invoked:
        update.run_fake_e2e_invoked ?? existing.run_fake_e2e_invoked,
      artifacts: update.artifacts ?? existing.artifacts,
    }
    sessions.set(taskId, session)
    return session
  }

  require(taskId: string): TaskSession {
    const session = sessions.get(taskId)
    if (!session) {
      throw new TaskSessionNotFoundError(taskId)
    }
    return session
  }

  applyControl(
    taskId: string,
    operation: Exclude<TaskOperation, 'START'>,
  ): { session: TaskSession; terminated_subagents: string[] } {
    const existing = this.require(taskId)
    let terminatedSubagents: string[] = []

    let status: TaskStatus
    switch (operation) {
      case 'PAUSE':
        status = 'PAUSED'
        break
      case 'CONTINUE':
        status = 'RUNNING'
        break
      case 'TERMINATE':
        status = 'TERMINATED'
        this.abortActiveQuery(taskId)
        terminatedSubagents = terminateRunningSubAgents(taskId)
        break
    }

    const session: TaskSession = {
      ...existing,
      status,
      ...(operation === 'TERMINATE'
        ? { finished_at: new Date().toISOString() }
        : {}),
    }
    sessions.set(taskId, session)
    return { session, terminated_subagents: terminatedSubagents }
  }

  patch(taskId: string, update: Partial<TaskSession>): TaskSession | undefined {
    const existing = sessions.get(taskId)
    if (!existing) return undefined
    const session = { ...existing, ...update }
    sessions.set(taskId, session)
    return session
  }

  get(taskId: string): TaskSession | undefined {
    return sessions.get(taskId)
  }

  has(taskId: string): boolean {
    return sessions.has(taskId)
  }

  getRunningSubAgentKeys(taskId?: string): string[] {
    return getRunningSubAgentKeys(taskId)
  }

  beginQueryAbortScope(taskId: string): AbortController {
    const existing = queryAbortControllers.get(taskId)
    if (existing) {
      return existing
    }
    const controller = new AbortController()
    queryAbortControllers.set(taskId, controller)
    return controller
  }

  endQueryAbortScope(taskId: string): void {
    queryAbortControllers.delete(taskId)
  }

  abortActiveQuery(taskId: string): void {
    const controller = queryAbortControllers.get(taskId)
    controller?.abort()
    queryAbortControllers.delete(taskId)
  }

  /** @internal test-only */
  static clearAll(): void {
    sessions.clear()
    queryAbortControllers.clear()
  }
}

export class TaskSessionNotFoundError extends Error {
  readonly taskId: string

  constructor(taskId: string) {
    super(`No task session found for task_id=${taskId}`)
    this.name = 'TaskSessionNotFoundError'
    this.taskId = taskId
  }
}

export function finishSessionFromFakeResult(
  manager: TaskSessionManager,
  taskId: string,
  result: InfTestFakeE2EResult,
): TaskSession {
  return manager.finish(taskId, {
    status: result.status,
    workspace: result.workspace,
    artifacts: result.artifacts,
    last_error: result.error,
    run_fake_e2e_invoked: false,
  })
}

export function finishSessionFromQueryResult(
  manager: TaskSessionManager,
  taskId: string,
  result: InfTestQueryRunnerResult,
): TaskSession {
  const toolResult = result.tool_result
  const existing = manager.get(taskId)
  const lastError =
    result.status === 'FAILED'
      ? result.errors.join('; ') || result.final_model_reply || 'query runner failed'
      : null
  const workspace = toolResult?.workspace ?? existing?.workspace
  const artifacts = toolResult?.artifacts ?? existing?.artifacts ?? {}
  return manager.finish(taskId, {
    status: result.status,
    workspace,
    artifacts,
    last_error: lastError,
    run_fake_e2e_invoked: result.run_fake_e2e_invoked,
  })
}
