import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { generatePlanWithLlm } from '../LlmPlanGenerator.js'
import { type PlanDetailInfo, ProxyClient } from '../adapters/ProxyClient.js'
import { WorkspaceManager } from '../adapters/WorkspaceManager.js'
import { copyUserInstructionFromPlanToTask, persistUserInstructionFromPayload } from './userInstructionStore.js'
import {
  buildManualCases,
  buildManualTestCasesArtifact,
  buildPlanDag,
} from '../skills/staticArtifacts.js'
import {
  buildDocFormatCasePublishArtifact,
  parseCasePublishCases,
  validateCasePublishBody,
  writeDocFormatTestCases,
} from './casePublishArtifacts.js'
import {
  enrichTaskReportBodyFromWorkspace,
  parseTaskReportGenerateRequest,
  persistTaskReportGenerateArtifacts,
} from './taskReportGenerateArtifacts.js'
import { fetchPrdToWorkspace } from '../adapters/PrdFetcher.js'
import { parsePlanConfigInfo } from '../schemas/planConfig.js'
import {
  getPlanWorkspace,
  parsePlanDetailFromBody,
  persistPlanConfig,
  persistPlanDetail,
  persistPlanLevelDetail,
  persistTaskPublishContext,
  prdSourceFromBody,
} from './planContextArtifacts.js'
import {
  applyTaskControl,
  ensureReportGenerationSession,
  getTaskExecutionSessionManager,
  getTaskReportGenerationStatus,
  mapReportStatusForApi,
  scheduleCaseExecutionAsync,
  scheduleCaseGenerationAsync,
  scheduleTaskRestartAsync,
  scheduleTaskReportGenerateAsync,
  scheduleTaskStartAsync,
} from './taskExecutionService.js'

type PlannerApiEndpoint =
  | '/api/generate-plan'
  | '/api/plan-task-publish'
  | '/api/case-publish'
  | '/api/task-report-generate'
  | '/api/task-manage'
  | '/api/user-instruction'
  | '/api/payload'

type PlannerResult = {
  httpStatus: number
  code: number
  message: string
  data?: Record<string, unknown>
}

type PlanContext = {
  plan_id: string
  plan_name: string | null
  project_id: string | null
  prd_file_key: string | null
  test_env_url: string | null
  test_strategies: string[]
  task_ids: string[]
  plan_detail_path: string | null
  tasks_path: string | null
  created_at: string
  updated_at: string
}

type ExecContext = {
  exec_id: string
  task_id: string
  plan_id: string | null
  case_count: number
  instructions: string[]
  payloads: string[]
  created_at: string
  updated_at: string
}

const planContexts = new Map<string, PlanContext>()
const execContexts = new Map<string, ExecContext>()
const idempotentResponses = new Map<string, PlannerResult>()
const plannerProxyClient = new ProxyClient()
const workspaceManager = new WorkspaceManager()

function nowIso(): string {
  return new Date().toISOString()
}

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
  return body as Record<string, unknown>
}

function stringField(
  body: Record<string, unknown>,
  field: string,
): string | null {
  const value = body[field]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function emptyPlanDetailInfo(): PlanDetailInfo {
  return {
    test_objectives: '',
    test_scope: '',
    test_target: '',
    test_environment: '',
    resources: '',
    schedule: '',
    deliverables: '',
  }
}

function normalizePlanDetailInfo(
  llmPlanDetail: Record<string, unknown> | null,
  body: Record<string, unknown>,
  planId: string,
): PlanDetailInfo {
  const source = llmPlanDetail ?? {}
  const planName = stringField(body, 'plan_name') ?? planId
  const strategies = Array.isArray(body.test_strategies)
    ? body.test_strategies.filter(v => typeof v === 'string').map(v => String(v))
    : []
  const strategiesText = strategies.length > 0 ? strategies.join(', ') : 'FUNCTIONAL'
  const projectName =
    stringField(body, 'project_name') ?? stringField(body, 'project_id') ?? planName
  const envUrl = stringField(body, 'test_env_url') ?? ''

  return {
    test_objectives: stringValue(
      source.test_objectives,
      `Validate core quality goals for ${planName}.`,
    ),
    test_scope: stringValue(
      source.test_scope,
      `Cover strategies: ${strategiesText}.`,
    ),
    test_target: stringValue(source.test_target, projectName),
    test_environment: stringValue(source.test_environment, envUrl),
    resources: stringValue(source.resources, 'To be assigned by execution policy.'),
    schedule: stringValue(source.schedule, 'Planned by orchestration stages.'),
    deliverables: stringValue(
      source.deliverables,
      'Plan detail, case tree, execution summary, and analysis report.',
    ),
  }
}

function reportPlanDetailAsync(
  planId: string,
  planDetail: PlanDetailInfo,
  failureReason: string,
): void {
  void plannerProxyClient
    .reportTestPlanDetail({
      plan_id: planId,
      plan_detail: planDetail,
      failure_reason: failureReason,
    })
    .catch(() => {
      /* non-blocking callback; retried externally */
    })
}

function ensureExecContext(
  execId: string,
  planId: string | null = null,
): ExecContext {
  const existing = execContexts.get(execId)
  if (existing) return existing
  const created: ExecContext = {
    exec_id: execId,
    task_id: execId,
    plan_id: planId,
    case_count: 0,
    instructions: [],
    payloads: [],
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  execContexts.set(execId, created)
  return created
}

function normalizedTaskType(strategy: string): string {
  const upper = strategy.trim().toUpperCase()
  if (upper === 'FUNCTIONAL' || upper === 'INTEGRATION' || upper === 'SMOKE') {
    return upper
  }
  return 'FUNCTIONAL'
}

function generateTasksFromPlanInput(
  planId: string,
  body: Record<string, unknown>,
): Array<{ task_id: string; task_name: string; task_type: string }> {
  const strategies = Array.isArray(body.test_strategies)
    ? body.test_strategies.filter(v => typeof v === 'string' && v.trim())
    : []
  const taskTypes = strategies.length > 0 ? strategies.map(v => String(v)) : ['FUNCTIONAL']
  return taskTypes.map((strategy, index) => ({
    task_id: `${planId}-task-${String(index + 1).padStart(3, '0')}`,
    task_name: `${stringField(body, 'plan_name') ?? planId}-${strategy}`,
    task_type: normalizedTaskType(strategy),
  }))
}

function readPlannerRunnerMode(): 'stateful' | 'query' {
  if (process.env.INFTEST_RUNNER === 'query') return 'query'
  if (process.env.INFTEST_STATEFUL_RUNNER === '1') return 'stateful'
  return process.env.INFTEST_RUNNER === 'stateful' ? 'stateful' : 'stateful'
}

function writeGeneratePlanArtifacts(
  planId: string,
  requestId: string,
  planDetail: Record<string, unknown>,
  tasks: Array<{ task_id: string; task_name: string; task_type: string }>,
): { planDetailPath: string; tasksPath: string } {
  const workspace = resolve(
    process.cwd(),
    '.inftest-workspace',
    'planner-real',
    planId,
  )
  mkdirSync(workspace, { recursive: true })
  const planDetailPath = join(workspace, 'plan_detail.json')
  const tasksPath = join(workspace, 'tasks.json')
  writeFileSync(planDetailPath, `${JSON.stringify(planDetail, null, 2)}\n`, 'utf8')
  writeFileSync(
    tasksPath,
    `${JSON.stringify(
      {
        request_id: requestId,
        plan_id: planId,
        tasks,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  return { planDetailPath, tasksPath }
}

function defaultData(
  requestId: string,
  endpoint: PlannerApiEndpoint,
): Record<string, unknown> {
  return {
    request_id: requestId,
    endpoint,
    accepted: true,
    stub: false,
  }
}

function resultWithData(
  requestId: string,
  endpoint: PlannerApiEndpoint,
  data: Record<string, unknown>,
): PlannerResult {
  return {
    httpStatus: 200,
    code: 0,
    message: 'success',
    data: {
      ...defaultData(requestId, endpoint),
      ...data,
    },
  }
}

function fail(
  httpStatus: number,
  code: number,
  message: string,
): PlannerResult {
  return { httpStatus, code, message }
}

async function handleGeneratePlan(
  requestId: string,
  body: Record<string, unknown>,
): Promise<PlannerResult> {
  const planId = stringField(body, 'plan_id') ?? `plan-${requestId}`
  const prdSource = prdSourceFromBody(body)
  const planWs = getPlanWorkspace(planId)
  mkdirSync(planWs, { recursive: true })

  const planConfig = parsePlanConfigInfo(body.plan_config_info)
  if (planConfig) {
    persistPlanConfig(planWs, planConfig)
  }

  let prdContent: string | null = null
  const prdAtPlan = await fetchPrdToWorkspace(prdSource, planWs)
  if (prdAtPlan) {
    prdContent = prdAtPlan.content
  }

  const llmPlan = await generatePlanWithLlm({
    plan_id: planId,
    plan_name: stringField(body, 'plan_name'),
    project_id: stringField(body, 'project_id'),
    test_env_url: stringField(body, 'test_env_url'),
    prd_file_key: stringField(body, 'prd_file_key'),
    prd_content: prdContent,
    remark: stringField(body, 'remark'),
    test_strategies: Array.isArray(body.test_strategies)
      ? body.test_strategies
          .filter(v => typeof v === 'string' && v.trim())
          .map(v => String(v))
      : [],
    runner_mode: readPlannerRunnerMode(),
  })

  const normalizedPlanDetail = normalizePlanDetailInfo(
    llmPlan?.plan_detail ?? null,
    body,
    planId,
  )
  const generatedTasks = llmPlan
    ? llmPlan.tasks.map((task, index) => ({
        task_id: `${planId}-task-${String(index + 1).padStart(3, '0')}`,
        task_name: task.task_name,
        task_type: task.task_type,
      }))
    : generateTasksFromPlanInput(planId, body)
  const taskIds = generatedTasks.map(task => task.task_id)
  const planDetail = {
    request_id: requestId,
    plan_id: planId,
    plan_name: stringField(body, 'plan_name'),
    project_id: stringField(body, 'project_id'),
    project_name: stringField(body, 'project_name'),
    prd_file_key: stringField(body, 'prd_file_key'),
    test_env_url: stringField(body, 'test_env_url'),
    test_strategies: Array.isArray(body.test_strategies) ? body.test_strategies : [],
    tasks: generatedTasks,
    plan_detail: normalizedPlanDetail,
    plan_detail_llm: llmPlan?.plan_detail ?? null,
    plan_generated_by: llmPlan ? 'llm' : 'fallback-template',
    generated_at: nowIso(),
  }

  let planDetailPath: string
  let tasksPath: string
  try {
    const written = writeGeneratePlanArtifacts(
      planId,
      requestId,
      planDetail,
      generatedTasks,
    )
    planDetailPath = written.planDetailPath
    tasksPath = written.tasksPath
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    reportPlanDetailAsync(planId, emptyPlanDetailInfo(), message)
    return fail(500, 500, `failed to persist generated plan artifacts: ${message}`)
  }

  const existing = planContexts.get(planId)
  const merged: PlanContext = {
    plan_id: planId,
    plan_name: stringField(body, 'plan_name'),
    project_id: stringField(body, 'project_id'),
    prd_file_key: stringField(body, 'prd_file_key'),
    test_env_url: stringField(body, 'test_env_url'),
    test_strategies: Array.isArray(body.test_strategies)
      ? body.test_strategies
          .filter(v => typeof v === 'string' && v.trim())
          .map(v => String(v))
      : [],
    task_ids: [...new Set([...(existing?.task_ids ?? []), ...taskIds])],
    plan_detail_path: planDetailPath,
    tasks_path: tasksPath,
    created_at: existing?.created_at ?? nowIso(),
    updated_at: nowIso(),
  }
  planContexts.set(planId, merged)
  for (const task of generatedTasks) {
    ensureExecContext(task.task_id, planId)
    try {
      const workspace = workspaceManager.getTaskWorkspace(task.task_id)
      void workspaceManager.init(task.task_id).then(async () => {
        if (planConfig) persistPlanConfig(workspace, planConfig)
        persistPlanDetail(workspace, normalizedPlanDetail)
        const prdInTask = await fetchPrdToWorkspace(prdSource, workspace)
        if (!prdInTask && prdContent) {
          const { writeFile } = await import('fs/promises')
          await writeFile(
            join(workspace, 'input', 'prd.md'),
            prdContent,
            'utf8',
          )
        }
        await workspaceManager.writeJson(workspace, 'plan.json', buildPlanDag(task.task_id))
        await workspaceManager.writeJson(
          workspace,
          'case_generation/test_cases.json',
          buildManualTestCasesArtifact(buildManualCases(task.task_id)),
        )
      })
    } catch {
      /* keep main flow accepted even if prewarm fails */
    }
  }

  persistPlanLevelDetail(planId, normalizedPlanDetail)
  reportPlanDetailAsync(planId, normalizedPlanDetail, '')

  return resultWithData(requestId, '/api/generate-plan', {
    plan_id: planId,
    plan_status: 'PENDING',
    task_count: generatedTasks.length,
    exec_ids: taskIds,
    plan_generated_by: llmPlan ? 'llm' : 'fallback-template',
    plan_detail_path: planDetailPath,
    tasks_path: tasksPath,
    async: true,
  })
}

async function persistTaskDetailForPlanPublish(
  taskId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const rawDetail = body.plan_detail
  const detail =
    rawDetail && typeof rawDetail === 'object' && !Array.isArray(rawDetail)
      ? (rawDetail as Record<string, unknown>)
      : {}
  const taskTarget =
    stringValue(detail.test_target) ||
    stringField(body, 'test_env_url') ||
    stringField(body, 'plan_name') ||
    taskId
  try {
    const workspace = workspaceManager.getTaskWorkspace(taskId)
    mkdirSync(join(workspace, 'input'), { recursive: true })
    writeFileSync(
      join(workspace, 'input', 'task_detail.json'),
      `${JSON.stringify(
        {
          exec_id: taskId,
          task_id: taskId,
          task_target: taskTarget,
          task_config: {
            enable_case_generation: true,
            enable_device_manager: true,
            enable_test_execution: true,
            enable_result_analysis: true,
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    await persistTaskPublishContext({
      taskId,
      body,
      prdSource: prdSourceFromBody(body),
      ensurePrd: true,
    })
  } catch {
    /* non-blocking; PlanSkill may still try proxy */
  }
}

function extractTaskIdsFromPublishBody(body: Record<string, unknown>): string[] {
  const directTasks = Array.isArray(body.tasks) ? body.tasks : []
  const taskList = Array.isArray(body.task_list) ? body.task_list : []
  const newTasks = Array.isArray(body.new_tasks) ? body.new_tasks : []
  const merged = [...directTasks, ...taskList, ...newTasks]
  const ids: string[] = []
  for (const item of merged) {
    if (!item || typeof item !== 'object') continue
    const id = stringField(item as Record<string, unknown>, 'task_id')
    if (id) ids.push(id)
  }
  return [...new Set(ids)]
}

async function handlePlanTaskPublish(
  requestId: string,
  body: Record<string, unknown>,
): Promise<PlannerResult> {
  const planId = stringField(body, 'plan_id')
  if (!planId) return fail(400, 400, 'invalid request: plan_id required')
  const taskIds = extractTaskIdsFromPublishBody(body)
  if (taskIds.length === 0) return fail(400, 400, 'invalid request: tasks required')

  const plan = planContexts.get(planId) ?? {
    plan_id: planId,
    plan_name: stringField(body, 'plan_name'),
    project_id: stringField(body, 'project_id'),
    prd_file_key: stringField(body, 'prd_file_key'),
    test_env_url: stringField(body, 'test_env_url'),
    test_strategies: [],
    task_ids: [],
    plan_detail_path: null,
    tasks_path: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }
  plan.task_ids = [...new Set([...plan.task_ids, ...taskIds])]
  plan.updated_at = nowIso()
  planContexts.set(planId, plan)

  const triggered: Array<{
    task_id: string
    accepted: boolean
    task_status: string
  }> = []
  for (const taskId of taskIds) {
    const ctx = ensureExecContext(taskId, planId)
    ctx.plan_id = planId
    ctx.updated_at = nowIso()
    execContexts.set(taskId, ctx)
    await persistTaskDetailForPlanPublish(taskId, body)

    // Doc flow: plan-task-publish triggers case generation only. Each task runs
    // PLANNING + DATA_GEN, reports its generated cases up via
    // proxy-update-task-status, then parks PAUSED awaiting case-publish.
    const scheduled = scheduleCaseGenerationAsync(taskId)
    triggered.push({
      task_id: taskId,
      accepted: scheduled.data.accepted,
      task_status: scheduled.data.task_status,
    })
  }

  return resultWithData(requestId, '/api/plan-task-publish', {
    plan_id: planId,
    publish_status: 'ACCEPTED',
    async: true,
    task_count: taskIds.length,
    exec_ids: taskIds,
    case_generation: 'TRIGGERED',
    tasks: triggered,
  })
}

function inferExecIdForCasePublish(
  body: Record<string, unknown>,
  planId: string | null,
): string | null {
  const direct =
    stringField(body, 'exec_id') ??
    stringField(body, 'task_id') ??
    stringField(body, 'case_task_id')
  if (direct) return direct

  if (!planId) return null
  const plan = planContexts.get(planId)
  if (!plan) return null
  if (plan.task_ids.length === 1) return plan.task_ids[0] ?? null
  return null
}

async function handleCasePublish(
  requestId: string,
  body: Record<string, unknown>,
): Promise<PlannerResult> {
  const planId = stringField(body, 'plan_id')
  const rawCases = Array.isArray(body.cases)
    ? body.cases
    : Array.isArray(body.task_list)
      ? body.task_list
      : Array.isArray(body.tasks)
        ? body.tasks
        : []
  const execId = inferExecIdForCasePublish(body, planId)
  if (!execId) {
    return fail(
      400,
      400,
      'case-publish requires exec_id/task_id when plan_id has no unique mapped task',
    )
  }

  const bodyWithExec: Record<string, unknown> = { ...body, exec_id: execId }
  const validationError = validateCasePublishBody(bodyWithExec)
  if (validationError) {
    return fail(400, 400, validationError)
  }

  const parsedCases = parseCasePublishCases(rawCases)
  if ('error' in parsedCases) {
    return fail(400, 400, parsedCases.error)
  }

  const ctx = ensureExecContext(execId, planId)
  ctx.case_count = parsedCases.cases.length
  ctx.updated_at = nowIso()
  execContexts.set(execId, ctx)

  try {
    const workspace = workspaceManager.getTaskWorkspace(execId)
    mkdirSync(workspace, { recursive: true })
    mkdirSync(join(workspace, 'case_generation'), { recursive: true })
    mkdirSync(join(workspace, 'input'), { recursive: true })
    const testCasesArtifact = buildDocFormatCasePublishArtifact(
      bodyWithExec,
      parsedCases.cases,
      {
        plan_id: planId,
        exec_id: execId,
        plan_name: stringField(body, 'plan_name'),
      },
    )
    writeDocFormatTestCases(workspace, testCasesArtifact)
    writeFileSync(
      join(workspace, 'input', 'case_publish_request.json'),
      `${JSON.stringify(testCasesArtifact, null, 2)}\n`,
      'utf8',
    )
    const planConfig = parsePlanConfigInfo(body.plan_config_info)
    if (planConfig) persistPlanConfig(workspace, planConfig)
    const planDetail = parsePlanDetailFromBody(body)
    if (planDetail) persistPlanDetail(workspace, planDetail)
    await persistTaskDetailForPlanPublish(execId, body)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(500, 500, `failed to persist case-publish artifacts: ${message}`)
  }

  const startResult = scheduleCaseExecutionAsync(execId)
  if (startResult.code !== 0) {
    return fail(startResult.httpStatus, startResult.code, startResult.message)
  }

  return resultWithData(requestId, '/api/case-publish', {
    plan_id: planId,
    exec_id: execId,
    task_id: execId,
    case_status: 'ACCEPTED',
    case_count: parsedCases.cases.length,
    task_operation: startResult.data.task_operation,
    task_status: startResult.data.task_status,
    auto_started: true,
    async: true,
  })
}

function toTaskManageResponse(
  requestId: string,
  operation: 'START' | 'RESTART' | 'PAUSE' | 'CONTINUE' | 'TERMINATION',
  result: PlannerResult,
): PlannerResult {
  if (result.code !== 0 || !result.data) return result
  return {
    ...result,
    data: {
      ...defaultData(requestId, '/api/task-manage'),
      ...result.data,
      task_operation: operation,
    },
  }
}

function handleTaskManage(
  requestId: string,
  body: Record<string, unknown>,
): PlannerResult {
  const execId = stringField(body, 'exec_id') ?? stringField(body, 'task_id')
  const operation = stringField(body, 'task_operation')
  if (!execId) return fail(400, 400, '/api/task-manage requires exec_id')
  if (!operation) return fail(400, 400, '/api/task-manage requires task_operation')

  switch (operation) {
    case 'START': {
      const r = scheduleTaskStartAsync(execId)
      return toTaskManageResponse(requestId, 'START', r)
    }
    case 'RESTART': {
      const r = scheduleTaskRestartAsync(execId)
      return toTaskManageResponse(requestId, 'RESTART', r)
    }
    case 'PAUSE': {
      const r = applyTaskControl(execId, 'PAUSE')
      return toTaskManageResponse(requestId, 'PAUSE', r)
    }
    case 'CONTINUE': {
      const r = applyTaskControl(execId, 'CONTINUE')
      return toTaskManageResponse(requestId, 'CONTINUE', r)
    }
    case 'TERMINATION': {
      const r = applyTaskControl(execId, 'TERMINATE')
      return toTaskManageResponse(requestId, 'TERMINATION', r)
    }
    default:
      return fail(400, 400, `Unsupported task_operation: ${operation}`)
  }
}

function handleTaskReportGenerate(
  requestId: string,
  body: Record<string, unknown>,
): PlannerResult {
  const execId = stringField(body, 'exec_id') ?? stringField(body, 'task_id')
  if (!execId) {
    return fail(400, 400, '/api/task-report-generate requires exec_id or task_id')
  }

  const session = ensureReportGenerationSession(execId)
  if (!session) {
    return fail(404, 404, `Exec task not found: ${execId}`)
  }

  const enrichedBody = enrichTaskReportBodyFromWorkspace(body, session.workspace)
  const parsed = parseTaskReportGenerateRequest(enrichedBody)
  if ('error' in parsed) {
    return fail(400, 400, parsed.error)
  }

  try {
    persistTaskReportGenerateArtifacts(session.workspace, enrichedBody, execId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(500, 500, `failed to persist task-report-generate artifacts: ${message}`)
  }

  const scheduleResult = scheduleTaskReportGenerateAsync(execId, {
    md_file_key: stringField(enrichedBody, 'md_file_key'),
  })
  if (scheduleResult.code !== 0 || !scheduleResult.data) {
    return fail(
      scheduleResult.httpStatus,
      scheduleResult.code,
      scheduleResult.message,
    )
  }

  const latestStatus = getTaskReportGenerationStatus(execId)
  const latestSession = getTaskExecutionSessionManager().get(execId)
  const internalStatus =
    latestStatus?.status ?? scheduleResult.data.report_status
  return resultWithData(requestId, '/api/task-report-generate', {
    exec_id: execId,
    task_id: execId,
    task_status: latestSession?.status ?? session.status,
    report_status: mapReportStatusForApi(internalStatus),
    report_path: latestStatus?.report_path ?? scheduleResult.data.report_path,
    report_file_key:
      latestStatus?.report_file_key ?? scheduleResult.data.report_file_key,
    accepted: scheduleResult.data.accepted,
    error: latestStatus?.error ?? scheduleResult.data.error ?? null,
    async: true,
  })
}

function inferExecForInstruction(body: Record<string, unknown>): string | null {
  return stringField(body, 'exec_id') ?? stringField(body, 'task_id')
}

function handleUserInstruction(
  requestId: string,
  body: Record<string, unknown>,
): PlannerResult {
  const planId = stringField(body, 'plan_id')
  const execId = inferExecForInstruction(body)
  const instruction = stringField(body, 'user_instruction')
  if (!instruction) return fail(400, 400, 'user_instruction required')

  if (execId) {
    const ctx = ensureExecContext(execId, planId)
    ctx.instructions.push(instruction)
    ctx.updated_at = nowIso()
    execContexts.set(execId, ctx)
    persistUserInstructionFromPayload({
      ...body,
      exec_id: execId,
      plan_id: planId,
      user_instruction: instruction,
    })
  }

  return resultWithData(requestId, '/api/user-instruction', {
    plan_id: planId,
    exec_id: execId,
    task_id: execId,
    message_id: requestId,
    finished: true,
    content: `Instruction accepted for ${execId ?? planId ?? 'session'}.`,
    async: true,
  })
}

function handlePayload(
  requestId: string,
  body: Record<string, unknown>,
): PlannerResult {
  const planId = stringField(body, 'plan_id')
  const execId = inferExecForInstruction(body)
  const payloadText = stringField(body, 'user_instruction') ?? JSON.stringify(body)
  if (execId) {
    const ctx = ensureExecContext(execId, planId)
    ctx.payloads.push(payloadText)
    ctx.updated_at = nowIso()
    execContexts.set(execId, ctx)
  }
  persistUserInstructionFromPayload(body)
  return resultWithData(requestId, '/api/payload', {
    plan_id: planId,
    exec_id: execId,
    task_id: execId,
    message_id: requestId,
    finished: true,
    content: `Payload accepted for ${execId ?? planId ?? 'session'}.`,
    async: true,
  })
}

export async function dispatchPlannerApiReal(
  endpoint: PlannerApiEndpoint,
  requestId: string,
  body: unknown,
): Promise<PlannerResult> {
  const idempotentKey = `${endpoint}:${requestId}`
  const cached = idempotentResponses.get(idempotentKey)
  if (cached) return cached

  const record = asRecord(body)
  const result = await (async () => {
    switch (endpoint) {
      case '/api/generate-plan':
        return handleGeneratePlan(requestId, record)
      case '/api/plan-task-publish':
        return await handlePlanTaskPublish(requestId, record)
      case '/api/case-publish':
        return await handleCasePublish(requestId, record)
      case '/api/task-report-generate':
        return handleTaskReportGenerate(requestId, record)
      case '/api/task-manage':
        return handleTaskManage(requestId, record)
      case '/api/user-instruction':
        return handleUserInstruction(requestId, record)
      case '/api/payload':
        return handlePayload(requestId, record)
    }
  })()

  idempotentResponses.set(idempotentKey, result)
  return result
}

export function resolveExecIdFromPlanContext(planId: string): string | null {
  const plan = planContexts.get(planId)
  if (!plan || plan.task_ids.length === 0) return null
  return plan.task_ids[0] ?? null
}

/** @internal test-only */
export function resetPlannerApiRealStateForTests(): void {
  planContexts.clear()
  execContexts.clear()
  idempotentResponses.clear()
}
