import { existsSync } from 'fs'
import { join } from 'path'
import { WorkspaceManager } from './adapters/WorkspaceManager.js'
import { InfTestStateMachine } from './InfTestStateMachine.js'
import {
  getRunningSubAgentKeys,
  terminateRunningSubAgents,
} from './adapters/SubAgentAdapter.js'
import type { InfTestAvailableAgentsE2EResult } from './AvailableAgentsRunner.js'
import type { InfTestFakeE2EResult } from './FakeE2ERunner.js'
import type { InfTestQueryRunnerResult } from './InfTestQueryRunner.js'
import type { InfTestStatefulRunnerResult } from './StatefulRunner.js'
import type {
  InfTestRunnerMode,
  InfTestTaskResponse,
  InfTestTaskSessionView,
  TaskSession,
} from './schemas/session.js'
import type { TaskOperation, TaskStatus } from './schemas/task.js'

const sessions = new Map<string, TaskSession>()

const queryAbortControllers = new Map<string, AbortController>()

const STANDARD_ARTIFACTS: [string, string][] = [
  ['plan', 'plan.json'],
  ['test_generation_result', join('case_generation', 'result.json')],
  ['test_cases', join('case_generation', 'test_cases.json')],
  ['device_scheduling_result', join('device_scheduling', 'result.json')],
  ['device_case_bind', join('device_scheduling', 'device_case_bind.json')],
  ['device_bindings', join('device_scheduling', 'device_bindings.json')],
  ['execution_result', join('execution', 'result.json')],
  ['execution_summary', join('execution', 'results', 'summary.json')],
  ['report_agent_log', join('execution', 'results', 'case_result.json')],
  ['analysis_result', join('analysis', 'result.json')],
  ['analysis_report_json', join('analysis', 'report.json')],
  ['analysis_report', join('analysis', 'report.md')],
]

function resolveWorkspace(taskId: string, workspace?: string): string {
  return workspace ?? new WorkspaceManager().getTaskWorkspace(taskId)
}

function collectExistingArtifacts(
  workspace: string | undefined,
): Record<string, string> {
  if (!workspace) return {}
  const artifacts: Record<string, string> = {}
  for (const [key, relativePath] of STANDARD_ARTIFACTS) {
    const artifactPath = join(workspace, relativePath)
    if (existsSync(artifactPath)) {
      artifacts[key] = artifactPath
    }
  }
  return artifacts
}

export function buildTaskMessage(session: TaskSession): string {
  if (session.last_error && session.status === 'FAILED') {
    return session.last_error
  }
  switch (session.status) {
    case 'SUCCESS': {
      const artifactCount = Object.keys(session.artifacts).length
      const invoked =
        session.runner === 'available'
          ? 'available CLI agents completed'
          : session.runner === 'stateful'
            ? 'stateful skills completed'
            : session.run_fake_e2e_invoked
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
      return session.current_stage
        ? `InfTest task ${session.task_id} is running at ${session.current_stage}.`
        : `InfTest task ${session.task_id} is running.`
    case 'TERMINATED':
      return `InfTest task ${session.task_id} was terminated.`
    case 'PENDING':
      return `InfTest task ${session.task_id} is pending.`
    default:
      return `InfTest task ${session.task_id} status: ${session.status}.`
  }
}

export function toTaskSessionView(
  session: TaskSession,
): InfTestTaskSessionView {
  return {
    task_id: session.task_id,
    runner: session.runner,
    status: session.status,
    current_stage: session.current_stage,
    previous_stage: session.previous_stage,
    active_skill: session.active_skill,
    blocking_reason: session.blocking_reason,
    stage_history: session.stage_history,
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
      current_stage: null,
      previous_stage: null,
      active_skill: null,
      blocking_reason: null,
      stage_history: [],
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

    const stateMachine = new InfTestStateMachine()
    let session: TaskSession
    switch (operation) {
      case 'PAUSE':
        session = stateMachine.pause(existing)
        break
      case 'CONTINUE':
        session = stateMachine.continue(existing)
        break
      case 'TERMINATE':
        this.abortActiveQuery(taskId)
        terminatedSubagents = terminateRunningSubAgents(taskId)
        session = {
          ...stateMachine.terminate(existing),
          finished_at: new Date().toISOString(),
        }
        break
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

export function finishSessionFromAvailableResult(
  manager: TaskSessionManager,
  taskId: string,
  result: InfTestAvailableAgentsE2EResult,
): TaskSession {
  return manager.finish(taskId, {
    status: result.status,
    workspace: result.workspace,
    artifacts: result.artifacts,
    last_error: result.error,
    run_fake_e2e_invoked: false,
  })
}

export function finishSessionFromStatefulResult(
  manager: TaskSessionManager,
  taskId: string,
  result: InfTestStatefulRunnerResult,
): TaskSession {
  return manager.finish(taskId, {
    status: result.status,
    workspace: result.workspace,
    artifacts: result.artifacts,
    last_error: result.error,
    run_fake_e2e_invoked: false,
  })
}

/**
 * Applies a stateful runner result without finishing the session when the runner
 * stopped early (stop_after_stage). Preserves PAUSED + current_stage for case-publish
 * / task-report-generate wait loops.
 */
export function applyStatefulRunnerResult(
  manager: TaskSessionManager,
  taskId: string,
  result: InfTestStatefulRunnerResult,
): TaskSession {
  if (result.stopped_after_stage) {
    const existing = manager.get(taskId)
    if (!existing) {
      throw new Error(`No task session for ${taskId}`)
    }
    const patched = manager.patch(taskId, {
      status: 'PAUSED',
      current_stage: result.stopped_after_stage,
      workspace: result.workspace,
      artifacts: { ...existing.artifacts, ...result.artifacts },
      active_skill: null,
    })
    if (!patched) {
      throw new Error(`No task session for ${taskId}`)
    }
    return patched
  }
  return finishSessionFromStatefulResult(manager, taskId, result)
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
      ? result.errors.join('; ') ||
        result.final_model_reply ||
        'query runner failed'
      : null
  const workspace = toolResult?.workspace ?? existing?.workspace
  const artifacts = {
    ...collectExistingArtifacts(workspace),
    ...(existing?.artifacts ?? {}),
    ...(toolResult?.artifacts ?? {}),
  }
  return manager.finish(taskId, {
    status: result.status,
    workspace,
    artifacts,
    last_error: lastError,
    run_fake_e2e_invoked: result.run_fake_e2e_invoked,
  })
}
