import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { runInfTestAvailableAgentsE2E } from '../AvailableAgentsRunner.js'
import { runInfTestFakeE2E } from '../FakeE2ERunner.js'
import { InfTestQueryRunner } from '../InfTestQueryRunner.js'
import { InfTestStepwiseQueryRunner } from '../InfTestStepwiseQueryRunner.js'
import { InvalidInfTestStateTransitionError } from '../InfTestStateMachine.js'
import { runInfTestStatefulRunner } from '../StatefulRunner.js'
import { SubAgentAdapter } from '../adapters/SubAgentAdapter.js'
import { bootstrapInfTestHeadless } from '../headlessBootstrap.js'
import type { InfTestFakeE2EStep } from '../FakeE2ERunner.js'
import type { InfTestRunnerMode, TaskSession } from '../schemas/session.js'
import type { InfTestStage } from '../schemas/task.js'
import type { StartTaskData } from '../schemas/api.js'
import {
  buildTaskMessage,
  finishSessionFromAvailableResult,
  finishSessionFromFakeResult,
  finishSessionFromQueryResult,
  finishSessionFromStatefulResult,
  applyStatefulRunnerResult,
  TaskSessionManager,
  TaskSessionNotFoundError,
  toTaskResponse,
} from '../TaskSessionManager.js'
import { registerInfTestSessionManager } from '../taskSessionRegistry.js'
import { readExecutableCasesFromTestCases } from './casePublishArtifacts.js'
import { resolveExecutionTimeoutSeconds } from './planContextArtifacts.js'
import { WorkspaceManager } from '../adapters/WorkspaceManager.js'
import {
  findReportDocx,
  reportAnalysisCompletionStatus,
  reportAnalysisFailedStatus,
  reportAnalysisRunningStatus,
} from './reportCompletionReporter.js'
import { buildReportAgentExtraArgs } from './userInstructionStore.js'

const workspaceManager = new WorkspaceManager()

const taskSessionManager = new TaskSessionManager()
registerInfTestSessionManager(taskSessionManager)
const reportGenerationJobs = new Map<string, TaskReportGenerateJob>()

export type TaskExecutionStartResult = {
  httpStatus: number
  code: number
  message: string
  data?: StartTaskData
}

export type TaskManageControlResult = {
  httpStatus: number
  code: number
  message: string
  data?: Record<string, unknown>
}

export type TaskManageAsyncStartResult = {
  httpStatus: number
  code: number
  message: string
  data: {
    exec_id: string
    task_id: string
    task_operation: string
    task_status: string
    accepted: boolean
    async: true
  }
}

type TaskReportStatus = 'PENDING' | 'RUNNING' | 'READY' | 'FAILED'

type TaskReportGenerateJob = {
  task_id: string
  status: TaskReportStatus
  report_path: string | null
  report_file_key: string | null
  /** Requirement doc or report-md path from the last task-report-generate request. */
  md_file_key: string | null
  error: string | null
  started_at: string
  updated_at: string
  finished_at: string | null
}

export type TaskReportGenerateScheduleInput = {
  md_file_key?: string | null
}

function normalizeReportMdFileKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** After FAILED, restart only when the client sends a different md_file_key. */
export function shouldRetryReportGenerationAfterFailed(
  current: TaskReportGenerateJob,
  incomingMdFileKey: string | null | undefined,
): boolean {
  if (current.status !== 'FAILED') return false
  const incoming = normalizeReportMdFileKey(incomingMdFileKey)
  if (!incoming) return false
  return incoming !== normalizeReportMdFileKey(current.md_file_key)
}

export type TaskReportGenerateAsyncResult = {
  httpStatus: number
  code: number
  message: string
  data?: {
    exec_id: string
    task_id: string
    report_status: TaskReportStatus
    report_path: string | null
    report_file_key: string | null
    accepted: boolean
    async: true
    error?: string | null
  }
}

function readRunnerMode(): InfTestRunnerMode {
  if (process.env.INFTEST_STATEFUL_RUNNER === '1') return 'stateful'
  if (process.env.INFTEST_RUNNER === 'stateful') return 'stateful'
  if (process.env.INFTEST_RUNNER === 'query') return 'query'
  if (process.env.INFTEST_RUNNER === 'available') return 'available'
  if (process.env.INFTEST_RUNNER === 'fake') return 'fake'
  return 'stateful'
}

function readOrchestration(): 'aggregate' | 'stepwise' {
  return process.env.INFTEST_ORCHESTRATION === 'stepwise'
    ? 'stepwise'
    : 'aggregate'
}

function readAvailableTimeoutSeconds(taskId?: string): number {
  const fallback = Number(process.env.INFTEST_TIMEOUT_SECONDS ?? 900)
  const base = Number.isFinite(fallback) ? fallback : 900
  if (!taskId) return base
  try {
    const workspace = new WorkspaceManager().getTaskWorkspace(taskId)
    return resolveExecutionTimeoutSeconds(workspace, base)
  } catch {
    return base
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function startDataFromSession(
  session: TaskSession,
  extra?: Partial<StartTaskData>,
): StartTaskData {
  const response = toTaskResponse(session)
  return {
    exec_id: response.task_id,
    task_id: response.task_id,
    task_status: response.status,
    current_stage: session.current_stage,
    workspace: response.workspace,
    runner: response.runner,
    artifacts: response.artifacts,
    run_fake_e2e_invoked: session.run_fake_e2e_invoked,
    ...extra,
  }
}

async function executeTaskRunner(
  taskId: string,
  runner: InfTestRunnerMode,
): Promise<TaskExecutionStartResult> {
  taskSessionManager.patch(taskId, { status: 'RUNNING', runner })

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
        steps:
          orchestration === 'aggregate' ? steps : steps.length > 0 ? steps : [],
      })
      const message =
        queryResult.final_model_reply && session.status === 'SUCCESS'
          ? queryResult.final_model_reply
          : buildTaskMessage(session)
      if (session.status === 'SUCCESS') {
        return { httpStatus: 200, code: 0, message, data }
      }
      return { httpStatus: 500, code: 500, message, data }
    } finally {
      taskSessionManager.endQueryAbortScope(taskId)
    }
  }

  if (runner === 'available') {
    const availableResult = await runInfTestAvailableAgentsE2E({
      task_id: taskId,
      timeout_seconds: readAvailableTimeoutSeconds(taskId),
    })
    const session = finishSessionFromAvailableResult(
      taskSessionManager,
      taskId,
      availableResult,
    )
    const data = startDataFromSession(session, {
      orchestration: 'aggregate',
      steps: availableResult.steps.map(s => ({
        name: s.name,
        status: s.status,
        duration_ms: s.duration_ms,
        message: s.message,
      })),
    })
    const message = buildTaskMessage(session)
    if (session.status === 'SUCCESS') {
      return { httpStatus: 200, code: 0, message, data }
    }
    return { httpStatus: 500, code: 500, message, data }
  }

  if (runner === 'stateful') {
    const statefulResult = await runInfTestStatefulRunner({
      task_id: taskId,
      timeout_seconds: readAvailableTimeoutSeconds(taskId),
      session_manager: taskSessionManager,
    })
    const session = finishSessionFromStatefulResult(
      taskSessionManager,
      taskId,
      statefulResult,
    )
    const data = startDataFromSession(session, {
      orchestration: 'stateful',
      steps: statefulResult.steps.map(s => ({
        name: s.name,
        status: s.status,
        duration_ms: s.duration_ms,
        message: s.message,
      })),
      current_stage: session.current_stage,
    })
    const message = buildTaskMessage(session)
    if (session.status === 'SUCCESS') {
      return { httpStatus: 200, code: 0, message, data }
    }
    return { httpStatus: 500, code: 500, message, data }
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
    return { httpStatus: 200, code: 0, message, data }
  }
  return { httpStatus: 500, code: 500, message, data }
}

async function runTaskStart(
  taskId: string,
  runner: InfTestRunnerMode,
): Promise<TaskExecutionStartResult> {
  bootstrapInfTestHeadless()
  taskSessionManager.start(taskId, runner)
  return executeTaskRunner(taskId, runner)
}

function readCasePublishWaitMs(): number {
  const value = Number(process.env.INFTEST_CASE_PUBLISH_WAIT_MS ?? 900_000)
  return Number.isFinite(value) && value > 0 ? value : 900_000
}

function readTaskReportWaitMs(): number {
  const value = Number(process.env.INFTEST_TASK_REPORT_WAIT_MS ?? 900_000)
  return Number.isFinite(value) && value > 0 ? value : 900_000
}

export type PublicReportStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED'

export function mapReportStatusForApi(
  status: TaskReportStatus,
): PublicReportStatus {
  if (status === 'READY') return 'SUCCESS'
  return status
}

export type WaitUntilExecutionPausedResult =
  | 'EXECUTION_PAUSED'
  | 'TIMEOUT'
  | 'MISSING'
  | 'FAILED'

export async function waitUntilExecutionPaused(
  taskId: string,
  timeoutMs: number,
): Promise<WaitUntilExecutionPausedResult> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const session = taskSessionManager.get(taskId)
    if (!session) return 'MISSING'
    if (session.status === 'PAUSED' && session.current_stage === 'EXECUTING') {
      return 'EXECUTION_PAUSED'
    }
    if (session.status === 'FAILED' || session.status === 'TERMINATED') {
      return 'FAILED'
    }
    if (!['RUNNING', 'PENDING', 'PAUSED'].includes(session.status)) {
      return 'TIMEOUT'
    }
    await Bun.sleep(500)
  }
  return 'TIMEOUT'
}

export function clearTaskReportGenerationJobsForTests(): void {
  reportGenerationJobs.clear()
}

/** @internal test-only */
export function seedReportGenerationJobForTests(
  taskId: string,
  job: Partial<TaskReportGenerateJob> & Pick<TaskReportGenerateJob, 'status'>,
): void {
  const existing = reportGenerationJobs.get(taskId)
  reportGenerationJobs.set(taskId, {
    task_id: taskId,
    status: job.status,
    report_path: job.report_path ?? existing?.report_path ?? null,
    report_file_key: job.report_file_key ?? existing?.report_file_key ?? null,
    md_file_key: job.md_file_key ?? existing?.md_file_key ?? null,
    error: job.error ?? existing?.error ?? null,
    started_at: job.started_at ?? existing?.started_at ?? nowIso(),
    updated_at: job.updated_at ?? nowIso(),
    finished_at: job.finished_at ?? existing?.finished_at ?? null,
  })
}

const CASE_EXECUTION_RESTART_STAGES: InfTestStage[] = [
  'COORDINATE',
  'EXECUTING',
  'REFLECTING',
]

function publishedTestCasesPath(taskId: string): string {
  return join(
    workspaceManager.getTaskWorkspace(taskId),
    'case_generation',
    'test_cases.json',
  )
}

/** True when case-publish (or equivalent) has written executable cases to disk. */
export function hasPublishedTestCasesOnDisk(taskId: string): boolean {
  const path = publishedTestCasesPath(taskId)
  if (!existsSync(path)) return false
  try {
    const payload = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return readExecutableCasesFromTestCases(payload).length > 0
  } catch {
    return false
  }
}

/**
 * After service restart or proxy-only case-publish: create a PAUSED session at DATA_GEN
 * so execution can resume from COORDINATE without re-running case generation.
 */
export function bootstrapCaseExecutionSessionFromDisk(
  taskId: string,
): TaskSession | null {
  if (!hasPublishedTestCasesOnDisk(taskId)) return null

  taskSessionManager.start(taskId, 'stateful')
  const testCasesPath = publishedTestCasesPath(taskId)
  const patched = taskSessionManager.patch(taskId, {
    status: 'PAUSED',
    current_stage: 'DATA_GEN',
    previous_stage: 'DATA_GEN',
    blocking_reason:
      'User-confirmed cases on disk; ready to run COORDINATE after case-publish',
    artifacts: {
      test_cases: testCasesPath,
    },
  })
  return patched ?? null
}

function executionCaseResultPath(taskId: string): string {
  return join(
    workspaceManager.getTaskWorkspace(taskId),
    'execution',
    'results',
    'case_result.json',
  )
}

/** True when execution has finished and case_result.json is on disk (post-restart report). */
export function hasExecutionCaseResultOnDisk(taskId: string): boolean {
  const path = executionCaseResultPath(taskId)
  if (!existsSync(path)) return false
  try {
    const payload = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
  } catch {
    return false
  }
}

function collectWorkspaceArtifactsForReport(
  workspace: string,
): Record<string, string> {
  const artifacts: Record<string, string> = {}
  const entries: [string, string][] = [
    ['report_agent_log', join('execution', 'results', 'case_result.json')],
    ['execution_result', join('execution', 'result.json')],
    ['test_cases', join('case_generation', 'test_cases.json')],
    ['analysis_result', join('analysis', 'result.json')],
  ]
  for (const [key, relativePath] of entries) {
    const artifactPath = join(workspace, relativePath)
    if (existsSync(artifactPath)) {
      artifacts[key] = artifactPath
    }
  }
  return artifacts
}

/**
 * After service restart: recreate PAUSED@EXECUTING when execution/results exist so
 * task-report-generate can run without re-executing cases.
 */
export function bootstrapReportGenerationSessionFromDisk(
  taskId: string,
): TaskSession | null {
  if (!hasExecutionCaseResultOnDisk(taskId)) return null

  const workspace = workspaceManager.getTaskWorkspace(taskId)
  const artifacts = collectWorkspaceArtifactsForReport(workspace)

  if (!taskSessionManager.has(taskId)) {
    taskSessionManager.start(taskId, 'stateful')
  }

  const patched = taskSessionManager.patch(taskId, {
    status: 'PAUSED',
    current_stage: 'EXECUTING',
    previous_stage: 'EXECUTING',
    workspace,
    blocking_reason:
      'Execution results on disk; ready for task-report-generate after restart',
    artifacts,
  })
  return patched ?? null
}

/** In-memory session, or restore from workspace when case_result.json exists. */
export function ensureReportGenerationSession(
  taskId: string,
): TaskSession | undefined {
  const existing = taskSessionManager.get(taskId)
  if (existing) return existing
  return bootstrapReportGenerationSessionFromDisk(taskId) ?? undefined
}

export function inferCaseExecutionTaskOperation(
  session: TaskSession | undefined,
): 'START' | 'RESTART' {
  if (!session) return 'START'
  if (['SUCCESS', 'FAILED', 'TERMINATED'].includes(session.status)) {
    return 'RESTART'
  }
  if (
    session.status === 'RUNNING' &&
    session.current_stage &&
    CASE_EXECUTION_RESTART_STAGES.includes(session.current_stage)
  ) {
    return 'RESTART'
  }
  return 'START'
}

export type WaitUntilPausedResult = 'PAUSED' | 'TIMEOUT' | 'MISSING' | 'FAILED'

export async function waitUntilPaused(
  taskId: string,
  timeoutMs: number,
): Promise<WaitUntilPausedResult> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const session = taskSessionManager.get(taskId)
    if (!session) return 'MISSING'
    if (session.status === 'PAUSED') return 'PAUSED'
    if (!['RUNNING', 'PENDING'].includes(session.status)) {
      if (session.status === 'FAILED') return 'FAILED'
      return 'TIMEOUT'
    }
    await Bun.sleep(500)
  }
  return 'TIMEOUT'
}

async function prepareCaseExecutionSession(
  taskId: string,
): Promise<
  | { ok: true; taskOperation: 'START' | 'RESTART' }
  | { ok: false; message: string }
> {
  let session = taskSessionManager.get(taskId)
  if (!session) {
    return {
      ok: false,
      message: 'Run plan-task-publish first; task session not found',
    }
  }

  const taskOperation = inferCaseExecutionTaskOperation(session)

  if (
    session.status === 'RUNNING' &&
    session.current_stage &&
    CASE_EXECUTION_RESTART_STAGES.includes(session.current_stage)
  ) {
    try {
      taskSessionManager.applyControl(taskId, 'TERMINATE')
    } catch {
      /* best effort before restart */
    }
    await Bun.sleep(500)
    session = taskSessionManager.get(taskId)
  }

  if (session?.status === 'PAUSED') {
    return { ok: true, taskOperation }
  }

  if (
    session &&
    ['SUCCESS', 'FAILED', 'TERMINATED'].includes(session.status)
  ) {
    return { ok: true, taskOperation: 'RESTART' }
  }

  if (session && (session.status === 'RUNNING' || session.status === 'PENDING')) {
    const waitResult = await waitUntilPaused(taskId, readCasePublishWaitMs())
    if (waitResult === 'PAUSED') {
      return { ok: true, taskOperation }
    }
    if (waitResult === 'MISSING') {
      return {
        ok: false,
        message: 'Task session disappeared while waiting for case generation',
      }
    }
    if (waitResult === 'FAILED') {
      return {
        ok: false,
        message: 'Case generation failed before case-publish could continue',
      }
    }
    return {
      ok: false,
      message: 'case generation not finished (expected PAUSED)',
    }
  }

  return {
    ok: false,
    message: `Unexpected task status: ${session?.status ?? 'missing'}`,
  }
}

function failAsyncTask(taskId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const existing = taskSessionManager.get(taskId)
  if (!existing) return
  taskSessionManager.finish(taskId, {
    status: 'FAILED',
    workspace: existing.workspace,
    artifacts: existing.artifacts,
    last_error: message,
    run_fake_e2e_invoked: false,
  })
}

async function runReportGenerationJob(taskId: string): Promise<void> {
  const existing = reportGenerationJobs.get(taskId)
  if (!existing) return
  reportGenerationJobs.set(taskId, {
    ...existing,
    status: 'RUNNING',
    updated_at: nowIso(),
  })

  const waitResult = await waitUntilExecutionPaused(taskId, readTaskReportWaitMs())
  if (waitResult !== 'EXECUTION_PAUSED') {
    const errorMessage =
      waitResult === 'MISSING'
        ? `Exec task not found while waiting for execution pause: ${taskId}`
        : waitResult === 'FAILED'
          ? `Task ${taskId} failed before report generation could start`
          : `Execution not finished (expected PAUSED at EXECUTING) for ${taskId}`
    reportGenerationJobs.set(taskId, {
      ...existing,
      status: 'FAILED',
      report_path: null,
      report_file_key: null,
      error: errorMessage,
      updated_at: nowIso(),
      finished_at: nowIso(),
    })
    return
  }

  const session = taskSessionManager.get(taskId)
  if (!session) {
    reportGenerationJobs.set(taskId, {
      ...existing,
      status: 'FAILED',
      report_path: null,
      report_file_key: null,
      error: `Exec task not found: ${taskId}`,
      updated_at: nowIso(),
      finished_at: nowIso(),
    })
    return
  }

  const caseResultPath = join(
    session.workspace,
    'execution',
    'results',
    'case_result.json',
  )
  if (!existsSync(caseResultPath)) {
    reportGenerationJobs.set(taskId, {
      ...existing,
      status: 'FAILED',
      report_path: null,
      report_file_key: null,
      error: `Missing proxy report input: ${caseResultPath}`,
      updated_at: nowIso(),
      finished_at: nowIso(),
    })
    return
  }

  const outputJson = join(session.workspace, 'analysis', 'result.json')
  const subAgent = new SubAgentAdapter()
  const invokeParams: Parameters<SubAgentAdapter['invoke']>[0] = {
    agent_name: 'result_analyzer',
    task_id: taskId,
    workspace: session.workspace,
    output_json: outputJson,
    timeout_seconds: readAvailableTimeoutSeconds(taskId),
  }
  if (process.env.INFTEST_REPORT_AGENT_CWD?.trim()) {
    invokeParams.adapter_script = 'scripts/inftest_real_report_agent_adapter.py'
  }
  const reportExtraArgs = buildReportAgentExtraArgs(session.workspace)
  if (Object.keys(reportExtraArgs).length > 0) {
    invokeParams.extra_args = reportExtraArgs
  }

  const reportStartedAt = await reportAnalysisRunningStatus({
    task_id: taskId,
    step_log: 'Report generation started',
  })

  const result = await subAgent.invoke(invokeParams)
  if (!result.success) {
    await reportAnalysisFailedStatus({
      task_id: taskId,
      step_log: result.error ?? 'Report generation failed',
      started_at: reportStartedAt,
    })
    reportGenerationJobs.set(taskId, {
      ...existing,
      status: 'FAILED',
      report_path: null,
      report_file_key: null,
      error: result.error ?? 'report generation failed',
      updated_at: nowIso(),
      finished_at: nowIso(),
    })
    return
  }

  const reportFromOutput =
    result.output?.artifacts.analysis_report ??
    join(session.workspace, 'analysis', 'report.md')
  const mergedArtifacts = {
    ...session.artifacts,
    analysis_result: outputJson,
    analysis_report: reportFromOutput,
    report_agent_log: caseResultPath,
    ...(result.output?.artifacts ?? {}),
  }
  taskSessionManager.patch(taskId, {
    artifacts: mergedArtifacts,
  })

  const delivered = await reportAnalysisCompletionStatus({
    task_id: taskId,
    workspace: session.workspace,
    artifact_hints: mergedArtifacts,
    step_log: 'Report generation completed',
    started_at: reportStartedAt,
  })

  taskSessionManager.finish(taskId, {
    status: 'SUCCESS',
    workspace: session.workspace,
    artifacts: mergedArtifacts,
    last_error: null,
    run_fake_e2e_invoked: false,
  })

  const reportDocxPath =
    delivered.report_files.find(item => item.kind === 'functional')?.path ??
    delivered.docx_path ??
    findReportDocx(session.workspace, mergedArtifacts) ??
    reportFromOutput

  reportGenerationJobs.set(taskId, {
    ...existing,
    status: 'READY',
    report_path: reportDocxPath,
    report_file_key: delivered.report_file_key,
    error: null,
    updated_at: nowIso(),
    finished_at: nowIso(),
  })
}

export function getTaskExecutionSessionManager(): TaskSessionManager {
  return taskSessionManager
}

export function getTaskReportGenerationStatus(
  taskId: string,
): TaskReportGenerateJob | null {
  return reportGenerationJobs.get(taskId) ?? null
}

export async function executeTaskStartSync(
  taskId: string,
  runner: InfTestRunnerMode = readRunnerMode(),
): Promise<TaskExecutionStartResult> {
  return runTaskStart(taskId, runner)
}

export function scheduleTaskStartAsync(
  taskId: string,
  runner: InfTestRunnerMode = readRunnerMode(),
): TaskManageAsyncStartResult {
  bootstrapInfTestHeadless()

  const existing = taskSessionManager.get(taskId)
  if (
    existing &&
    (existing.status === 'RUNNING' || existing.status === 'PENDING')
  ) {
    return {
      httpStatus: 409,
      code: 409,
      message: `Task ${taskId} is already ${existing.status}`,
      data: {
        exec_id: taskId,
        task_id: taskId,
        task_operation: 'START',
        task_status: existing.status,
        accepted: false,
        async: true,
      },
    }
  }

  taskSessionManager.start(taskId, runner)
  taskSessionManager.patch(taskId, { status: 'PENDING' })

  void executeTaskRunner(taskId, runner).catch(error => {
    failAsyncTask(taskId, error)
  })

  return {
    httpStatus: 200,
    code: 0,
    message: 'Task accepted and scheduled for async execution',
    data: {
      exec_id: taskId,
      task_id: taskId,
      task_operation: 'START',
      task_status: 'PENDING',
      accepted: true,
      async: true,
    },
  }
}

/**
 * Runs case generation only (PLANNING + DATA_GEN) for a task, then stops with
 * the task PAUSED awaiting case-publish. Used by /api/plan-task-publish to
 * satisfy the doc flow: proxy requests case generation, generated cases are
 * reported up via proxy-update-task-status, then the user reviews before
 * case-publish drives execution. Returns immediately (async).
 */
export function scheduleCaseGenerationAsync(
  taskId: string,
): TaskManageAsyncStartResult {
  bootstrapInfTestHeadless()

  const existing = taskSessionManager.get(taskId)
  if (
    existing &&
    (existing.status === 'RUNNING' || existing.status === 'PENDING')
  ) {
    return {
      httpStatus: 409,
      code: 409,
      message: `Task ${taskId} is already ${existing.status}`,
      data: {
        exec_id: taskId,
        task_id: taskId,
        task_operation: 'START',
        task_status: existing.status,
        accepted: false,
        async: true,
      },
    }
  }

  // Keep status RUNNING: StatefulRunner.start() requires RUNNING/null stage for the
  // START transition into PLANNING. Do not patch to PENDING here (unlike full-pipeline
  // scheduleTaskStartAsync which sets RUNNING again inside executeTaskRunner).
  taskSessionManager.start(taskId, 'stateful')

  void runInfTestStatefulRunner({
    task_id: taskId,
      timeout_seconds: readAvailableTimeoutSeconds(taskId),
      session_manager: taskSessionManager,
      stop_after_stage: 'DATA_GEN',
  }).catch(error => {
    failAsyncTask(taskId, error)
  })

  return {
    httpStatus: 200,
    code: 0,
    message: 'Case generation accepted and scheduled for async execution',
    data: {
      exec_id: taskId,
      task_id: taskId,
      task_operation: 'START',
      task_status: 'PENDING',
      accepted: true,
      async: true,
    },
  }
}

/**
 * Drives execution for a task whose cases were already generated (and parked
 * PAUSED) by plan-task-publish. Used by /api/case-publish after the user has
 * reviewed/edited cases. Waits for any in-flight case generation to settle,
 * then resumes the stateful runner from COORDINATE (skipping case generation)
 * so the user-confirmed cases on disk are executed as-is. When no in-memory session
 * exists but test_cases.json is already on disk (case-publish or post-restart),
 * bootstraps a PAUSED session at DATA_GEN. Returns immediately (async).
 */
export function scheduleCaseExecutionAsync(
  taskId: string,
): TaskManageAsyncStartResult {
  bootstrapInfTestHeadless()

  let existing = taskSessionManager.get(taskId)
  if (!existing) {
    existing = bootstrapCaseExecutionSessionFromDisk(taskId) ?? undefined
  }
  if (!existing) {
    return {
      httpStatus: 409,
      code: 409,
      message:
        'No task session and no published test_cases.json; send case-publish with cases or run plan-task-publish first',
      data: {
        exec_id: taskId,
        task_id: taskId,
        task_operation: 'START',
        task_status: 'PENDING',
        accepted: false,
        async: true,
      },
    }
  }

  const taskOperation = inferCaseExecutionTaskOperation(existing)

  void (async () => {
    const prepared = await prepareCaseExecutionSession(taskId)
    if (!prepared.ok) {
      failAsyncTask(taskId, new Error(prepared.message))
      return
    }
    const result = await runInfTestStatefulRunner({
      task_id: taskId,
      timeout_seconds: readAvailableTimeoutSeconds(taskId),
      session_manager: taskSessionManager,
      start_from_stage: 'COORDINATE',
      stop_after_stage: 'EXECUTING',
    })
    applyStatefulRunnerResult(taskSessionManager, taskId, result)
  })().catch(error => {
    failAsyncTask(taskId, error)
  })

  return {
    httpStatus: 200,
    code: 0,
    message: 'Case execution accepted and scheduled for async execution',
    data: {
      exec_id: taskId,
      task_id: taskId,
      task_operation: taskOperation,
      task_status: existing.status,
      accepted: true,
      async: true,
    },
  }
}

export function scheduleTaskRestartAsync(
  taskId: string,
  runner: InfTestRunnerMode = readRunnerMode(),
): TaskManageAsyncStartResult {
  bootstrapInfTestHeadless()
  const existing = taskSessionManager.get(taskId)
  if (existing && existing.status !== 'TERMINATED' && existing.status !== 'FAILED' && existing.status !== 'SUCCESS') {
    try {
      taskSessionManager.applyControl(taskId, 'TERMINATE')
    } catch {
      /* best effort before restart */
    }
  }
  return scheduleTaskStartAsync(taskId, runner)
}

export function scheduleTaskReportGenerateAsync(
  taskId: string,
  input: TaskReportGenerateScheduleInput = {},
): TaskReportGenerateAsyncResult {
  const session = ensureReportGenerationSession(taskId)
  if (!session) {
    return {
      httpStatus: 404,
      code: 404,
      message: `Exec task not found: ${taskId}`,
    }
  }

  const incomingMdFileKey = normalizeReportMdFileKey(input.md_file_key)
  const current = reportGenerationJobs.get(taskId)
  if (current) {
    if (shouldRetryReportGenerationAfterFailed(current, incomingMdFileKey)) {
      reportGenerationJobs.delete(taskId)
    } else {
      return {
        httpStatus: 200,
        code: 0,
        message:
          current.status === 'FAILED'
            ? 'Report generation previously failed; provide a new md_file_key to retry'
            : 'Report generation status fetched',
        data: {
          exec_id: taskId,
          task_id: taskId,
          report_status: current.status,
          report_path: current.report_path,
          report_file_key: current.report_file_key,
          accepted: false,
          async: true,
          error: current.error,
        },
      }
    }
  }

  const created: TaskReportGenerateJob = {
    task_id: taskId,
    status: 'PENDING',
    report_path: null,
    report_file_key: null,
    md_file_key: incomingMdFileKey,
    error: null,
    started_at: nowIso(),
    updated_at: nowIso(),
    finished_at: null,
  }
  reportGenerationJobs.set(taskId, created)
  void runReportGenerationJob(taskId).catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    const failedJob = reportGenerationJobs.get(taskId)
    const startedAt = failedJob?.started_at ?? nowIso()
    reportGenerationJobs.set(taskId, {
      task_id: taskId,
      status: 'FAILED',
      report_path: null,
      report_file_key: null,
      md_file_key: failedJob?.md_file_key ?? incomingMdFileKey,
      error: message,
      started_at: startedAt,
      updated_at: nowIso(),
      finished_at: nowIso(),
    })
  })

  return {
    httpStatus: 200,
    code: 0,
    message:
      current?.status === 'FAILED'
        ? 'Report generation re-scheduled after md_file_key change'
        : 'Report generation accepted and scheduled',
    data: {
      exec_id: taskId,
      task_id: taskId,
      report_status: 'PENDING',
      report_path: null,
      report_file_key: null,
      accepted: true,
      async: true,
    },
  }
}

export function applyTaskControl(
  taskId: string,
  operation: 'PAUSE' | 'CONTINUE' | 'TERMINATE',
): TaskManageControlResult {
  try {
    if (operation === 'TERMINATE') {
      const { session } = taskSessionManager.applyControl(taskId, 'TERMINATE')
      return {
        httpStatus: 200,
        code: 0,
        message: 'Task terminated',
        data: {
          exec_id: taskId,
          task_id: taskId,
          task_operation: 'TERMINATION',
          task_status: session.status,
        },
      }
    }

    const messages: Record<'PAUSE' | 'CONTINUE', string> = {
      PAUSE: 'Task paused',
      CONTINUE: 'Task continued',
    }
    const { session } = taskSessionManager.applyControl(taskId, operation)
    return {
      httpStatus: 200,
      code: 0,
      message: messages[operation],
      data: {
        exec_id: taskId,
        task_id: taskId,
        task_operation: operation,
        task_status: session.status,
      },
    }
  } catch (error) {
    if (error instanceof TaskSessionNotFoundError) {
      return {
        httpStatus: 404,
        code: 404,
        message: `Exec task not found: ${taskId}. Call POST /api/task-manage with START first.`,
      }
    }
    if (error instanceof InvalidInfTestStateTransitionError) {
      return {
        httpStatus: 400,
        code: 400,
        message: error.message,
      }
    }
    throw error
  }
}
