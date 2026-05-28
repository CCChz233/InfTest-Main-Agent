import { access } from 'fs/promises'
import { join } from 'path'
import { ExecutionResultWatcher } from './adapters/ExecutionResultWatcher.js'
import { ProxyClient } from './adapters/ProxyClient.js'
import { WorkspaceManager } from './adapters/WorkspaceManager.js'
import { HookManager } from './HookManager.js'
import { InfTestStateMachine } from './InfTestStateMachine.js'
import { TaskSessionManager } from './TaskSessionManager.js'
import type { TaskStatus } from './schemas/task.js'
import {
  createDefaultSkillRegistry,
  SkillRegistry,
  type SkillResult,
} from './skills/index.js'

export const DEFAULT_INFTEST_STATEFUL_TASK_ID = 'task-stateful-001'

export type RunInfTestStatefulRunnerInput = {
  task_id?: string
  workspace_root?: string
  timeout_seconds?: number
  device_id?: string
  session_manager?: TaskSessionManager
  skill_registry?: SkillRegistry
  hook_manager?: HookManager
  state_machine?: InfTestStateMachine
}

export type InfTestStatefulRunnerStep = {
  name: string
  status: 'SUCCESS' | 'FAILED'
  duration_ms: number
  message?: string
}

export type InfTestStatefulRunnerResult = {
  task_id: string
  status: Extract<TaskStatus, 'SUCCESS' | 'FAILED'>
  workspace: string
  artifacts: Record<string, string>
  reported_cases: string[]
  summary_found: boolean
  steps: InfTestStatefulRunnerStep[]
  error: string | null
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function resultErrorMessage(result: SkillResult): string {
  return result.error?.message ?? result.message ?? 'Skill failed'
}

function unknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function terminalStatus(
  status: TaskStatus,
): Extract<TaskStatus, 'SUCCESS' | 'FAILED'> {
  return status === 'SUCCESS' ? 'SUCCESS' : 'FAILED'
}

export async function runInfTestStatefulRunner(
  input: RunInfTestStatefulRunnerInput = {},
): Promise<InfTestStatefulRunnerResult> {
  const taskId = input.task_id ?? DEFAULT_INFTEST_STATEFUL_TASK_ID
  const workspaceManager = new WorkspaceManager(input.workspace_root)
  const workspace = workspaceManager.getTaskWorkspace(taskId)
  await workspaceManager.init(taskId)

  const manager = input.session_manager ?? new TaskSessionManager()
  let session = manager.get(taskId) ?? manager.start(taskId, 'stateful')
  session =
    manager.patch(taskId, {
      runner: 'stateful',
      workspace,
    }) ?? session

  const hooks = input.hook_manager ?? new HookManager(workspace)
  const stateMachine = input.state_machine ?? new InfTestStateMachine()
  const skills =
    input.skill_registry ??
    createDefaultSkillRegistry({
      timeout_seconds: input.timeout_seconds,
      device_id: input.device_id,
    })
  const steps: InfTestStatefulRunnerStep[] = []
  let reportedCases: string[] = []
  let executionSummaryFound = false

  const patchSession = (next: typeof session): typeof session => {
    const patched = manager.patch(taskId, next)
    if (!patched) throw new Error(`No task session for ${taskId}`)
    session = patched
    return session
  }

  const recordLatestTransition = async (): Promise<void> => {
    const latest = session.stage_history.at(-1)
    if (latest) await hooks.recordStateTransition(latest)
  }

  const finish = async (
    status: Extract<TaskStatus, 'SUCCESS' | 'FAILED'>,
    message: string,
  ): Promise<InfTestStatefulRunnerResult> => {
    session = manager.finish(taskId, {
      status,
      workspace,
      artifacts: session.artifacts,
      last_error: status === 'FAILED' ? message : null,
      run_fake_e2e_invoked: false,
    })
    await hooks.onTaskFinish(session, {
      status,
      message,
      artifacts: session.artifacts,
    })
    return {
      task_id: taskId,
      status,
      workspace,
      artifacts: session.artifacts,
      reported_cases: reportedCases,
      summary_found: await pathExists(
        join(workspace, 'execution', 'results', 'summary.json'),
      ).then(found => executionSummaryFound || found),
      steps,
      error: status === 'FAILED' ? message : null,
    }
  }

  const fail = async (
    message: string,
  ): Promise<InfTestStatefulRunnerResult> => {
    session = patchSession(
      stateMachine.fail(
        {
          ...session,
          active_skill: null,
        },
        message,
      ),
    )
    await recordLatestTransition()
    return finish('FAILED', message)
  }

  try {
    await hooks.onTaskStart(session)
    session = patchSession(stateMachine.start(session))
    await recordLatestTransition()
    await hooks.onEnterStage(session)

    while (session.status === 'RUNNING' && session.current_stage) {
      const skill = skills.requireByStage(session.current_stage)
      session = patchSession({
        ...session,
        active_skill: skill.name,
      })
      await hooks.beforeSkillCall(session, skill)

      const startedAt = Date.now()
      let result: SkillResult
      try {
        result = await skill.run({
          task_id: taskId,
          workspace,
          session,
        })
      } catch (error) {
        const durationMs = Date.now() - startedAt
        const message = unknownErrorMessage(error)
        steps.push({
          name: skill.name,
          status: 'FAILED',
          duration_ms: durationMs,
          message,
        })
        session = patchSession({
          ...session,
          active_skill: null,
        })
        await hooks.onSkillError(session, skill, error)
        return fail(message)
      }

      const durationMs = Date.now() - startedAt
      session = patchSession({
        ...session,
        active_skill: null,
        artifacts: {
          ...session.artifacts,
          ...result.artifacts,
        },
      })
      await hooks.afterSkillCall(session, skill, result, durationMs)
      steps.push({
        name: skill.name,
        status: result.status,
        duration_ms: durationMs,
        message: result.message ?? result.error?.message,
      })

      if (result.status === 'FAILED') {
        await hooks.onSkillError(session, skill, result.error ?? result)
        return fail(resultErrorMessage(result))
      }

      if (session.current_stage === 'EXECUTING') {
        const watchResult = await new ExecutionResultWatcher(
          new ProxyClient(),
        ).watch({
          task_id: taskId,
          results_dir: join(workspace, 'execution', 'results'),
          summary_path: join(workspace, 'execution', 'results', 'summary.json'),
        })
        reportedCases = watchResult.reported_cases
        executionSummaryFound = watchResult.summary_found
      }

      if (session.current_stage === 'COMPLETED') {
        session = patchSession(stateMachine.complete(session))
        await recordLatestTransition()
        return finish('SUCCESS', 'Stateful runner completed')
      }

      session = patchSession(stateMachine.advance(session))
      await recordLatestTransition()
      await hooks.onEnterStage(session)
    }

    return finish(
      terminalStatus(session.status),
      `Task ended as ${session.status}`,
    )
  } catch (error) {
    return fail(unknownErrorMessage(error))
  }
}
