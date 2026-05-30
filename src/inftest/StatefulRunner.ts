import { access } from 'fs/promises'
import { join } from 'path'
import { ProxyClient } from './adapters/ProxyClient.js'
import { resolveAgentName, mapPartialStopProxyStatus } from './adapters/updateTaskStatusPayload.js'
import { WorkspaceManager } from './adapters/WorkspaceManager.js'
import { HookManager } from './HookManager.js'
import { InfTestStateMachine } from './InfTestStateMachine.js'
import { logEvent } from './observability/logger.js'
import { reportPlanFinalStatusWithUpload } from './planFinalReporter.js'
import { TaskSessionManager } from './TaskSessionManager.js'
import { resolveExecutionTimeoutSeconds } from './server/planContextArtifacts.js'
import type { InfTestStage, TaskStatus } from './schemas/task.js'
import type { ProxyAgentStatus } from './schemas/update.js'
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
  /**
   * When set, the runner stops after this stage completes successfully instead
   * of advancing to the next stage. Used by plan-task-publish to run case
   * generation only (stop_after_stage='DATA_GEN'), leaving the task PAUSED and
   * awaiting case-publish to drive execution.
   */
  stop_after_stage?: InfTestStage
  /**
   * When set, the runner resumes an existing session at this stage instead of
   * starting at PLANNING. Used by case-publish to run execution
   * (start_from_stage='COORDINATE') with user-confirmed cases.
   */
  start_from_stage?: InfTestStage
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
  /** Set when the runner stopped early due to stop_after_stage. */
  stopped_after_stage?: InfTestStage | null
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
  const resolvedTimeout =
    input.timeout_seconds ??
    resolveExecutionTimeoutSeconds(
      workspace,
      Number(process.env.INFTEST_TIMEOUT_SECONDS ?? 900),
    )
  const skills =
    input.skill_registry ??
    createDefaultSkillRegistry({
      timeout_seconds: resolvedTimeout,
      device_id: input.device_id,
    })
  const steps: InfTestStatefulRunnerStep[] = []
  let reportedCases: string[] = []
  let executionSummaryFound = false
  const proxy = new ProxyClient()
  const stopAfterStage = input.stop_after_stage ?? null
  const startFromStage = input.start_from_stage ?? null

  // Best-effort per-agent status report for the 4.1.3 任务状态上报 contract.
  // Only the agent-owned stages are reported here; overall task completion is
  // reported separately via reportPlanFinalStatusWithUpload.
  const reportAgentStatus = async (params: {
    stage: InfTestStage
    status: Extract<TaskStatus, 'RUNNING' | 'SUCCESS' | 'FAILED' | 'PAUSED'>
    proxyStatus?: ProxyAgentStatus
    startedAtMs: number
    endedAtMs?: number
    result?: SkillResult
    errorMessage?: string
  }): Promise<void> => {
    const agent = resolveAgentName({ current_stage: params.stage })
    if (!agent) return
    const telemetry = params.result?.telemetry
    const proxyStatus = params.proxyStatus ?? undefined
    try {
      await proxy.reportTaskUpdate({
        event_id: `${taskId}:${params.stage.toLowerCase()}:${(proxyStatus ?? params.status).toLowerCase()}`,
        task_id: taskId,
        agent_name: telemetry?.agent_name ?? agent,
        task_status: params.status,
        proxy_status: proxyStatus,
        current_stage: params.stage,
        total_tokens: telemetry?.total_tokens ?? 0,
        output_json:
          telemetry?.output_json ??
          (params.stage === 'REFLECTING'
            ? '{}'
            : params.result
              ? JSON.stringify(params.result.artifacts)
              : ''),
        step_log:
          telemetry?.step_log ??
          params.errorMessage ??
          params.result?.message ??
          '',
        start_time: new Date(params.startedAtMs).toISOString(),
        end_time:
          params.status === 'RUNNING' && !proxyStatus
            ? undefined
            : new Date(params.endedAtMs ?? Date.now()).toISOString(),
        stage_operations: [],
        case_node_operations: [],
        case_detail_operations: [],
      })
    } catch (error) {
      logEvent('warn', 'stateful.report_agent_status.failed', {
        task_id: taskId,
        stage: params.stage,
        status: params.status,
        error,
      })
    }
  }

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
    await reportPlanFinalStatusWithUpload({
      task_id: taskId,
      task_status: status,
      workspace,
      message,
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

  // Early stop for stop_after_stage (e.g. case generation only). The task is
  // parked as PAUSED so a later case-publish can drive execution. We do NOT
  // report a final plan status here because the plan is not yet complete.
  const finishPartial = async (
    stage: InfTestStage,
  ): Promise<InfTestStatefulRunnerResult> => {
    const proxyStatus = mapPartialStopProxyStatus(stage)
    const pauseMessage =
      stage === 'DATA_GEN'
        ? '用例生成完成，等待 case-publish 用户确认'
        : '用例执行完成，等待 task-report-generate'

    await reportAgentStatus({
      stage,
      status: 'PAUSED',
      proxyStatus,
      startedAtMs: Date.now(),
      endedAtMs: Date.now(),
      errorMessage: pauseMessage,
    })

    session = patchSession({
      ...session,
      active_skill: null,
      status: 'PAUSED',
      current_stage: stage,
    })
    logEvent('info', 'stateful.stopped_after_stage', {
      task_id: taskId,
      stage,
    })
    return {
      task_id: taskId,
      status: 'SUCCESS',
      workspace,
      artifacts: session.artifacts,
      reported_cases: reportedCases,
      summary_found: executionSummaryFound,
      steps,
      error: null,
      stopped_after_stage: stage,
    }
  }

  try {
    if (startFromStage) {
      // Resume an existing (typically PAUSED) session directly at the given
      // stage, skipping PLANNING + DATA_GEN. Used by case-publish to drive
      // execution with user-confirmed cases without regenerating them.
      session = patchSession({
        ...session,
        status: 'RUNNING',
        current_stage: startFromStage,
        active_skill: null,
      })
      logEvent('info', 'stateful.start_from_stage', {
        task_id: taskId,
        stage: startFromStage,
      })
      await hooks.onEnterStage(session)
    } else {
      await hooks.onTaskStart(session)
      session = patchSession(stateMachine.start(session))
      await recordLatestTransition()
      await hooks.onEnterStage(session)
    }

    while (session.status === 'RUNNING' && session.current_stage) {
      const skill = skills.requireByStage(session.current_stage)
      session = patchSession({
        ...session,
        active_skill: skill.name,
      })
      await hooks.beforeSkillCall(session, skill)

      const startedAt = Date.now()
      const stage = skill.stage
      await reportAgentStatus({ stage, status: 'RUNNING', startedAtMs: startedAt })
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
        await reportAgentStatus({
          stage,
          status: 'FAILED',
          startedAtMs: startedAt,
          endedAtMs: startedAt + durationMs,
          errorMessage: message,
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
        await reportAgentStatus({
          stage,
          status: 'FAILED',
          startedAtMs: startedAt,
          endedAtMs: startedAt + durationMs,
          result,
          errorMessage: resultErrorMessage(result),
        })
        await hooks.onSkillError(session, skill, result.error ?? result)
        return fail(resultErrorMessage(result))
      }

      await reportAgentStatus({
        stage,
        status: 'SUCCESS',
        startedAtMs: startedAt,
        endedAtMs: startedAt + durationMs,
        result,
      })

      if (stopAfterStage && stage === stopAfterStage) {
        return finishPartial(stage)
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
