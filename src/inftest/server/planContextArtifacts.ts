import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import type { PlanDetailInfo } from '../adapters/ProxyClient.js'
import {
  fetchPrdToWorkspace,
  readPrdFromWorkspace,
  type PrdSourceInput,
} from '../adapters/PrdFetcher.js'
import { WorkspaceManager } from '../adapters/WorkspaceManager.js'
import {
  executionTimeoutSecondsFromConfig,
  parsePlanConfigInfo,
  type PlanConfigInfo,
} from '../schemas/planConfig.js'
import { copyUserInstructionFromPlanToTask } from './userInstructionStore.js'

export const PLAN_CONFIG_REL_PATH = 'input/plan_config.json'
export const PLAN_DETAIL_REL_PATH = 'input/plan_detail.json'
export const TASK_META_REL_PATH = 'input/task_meta.json'

export type PlanQaEntry = { question: string; answer: string }

export type TaskMetaEntry = {
  task_id: string
  task_type?: string
  task_name?: string
}

function stringField(body: Record<string, unknown>, field: string): string | null {
  const value = body[field]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function getPlannerRealRoot(cwd = process.cwd()): string {
  return resolve(cwd, '.inftest-workspace', 'planner-real')
}

export function getPlanWorkspace(planId: string, cwd = process.cwd()): string {
  return join(getPlannerRealRoot(cwd), planId)
}

export function parsePlanDetailFromBody(
  body: Record<string, unknown>,
): PlanDetailInfo | null {
  const raw = body.plan_detail
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  return {
    test_objectives: stringValue(record.test_objectives),
    test_scope: stringValue(record.test_scope),
    test_target: stringValue(record.test_target),
    test_environment: stringValue(record.test_environment),
    resources: stringValue(record.resources),
    schedule: stringValue(record.schedule),
    deliverables: stringValue(record.deliverables),
  }
}

export function parsePlanQaList(body: Record<string, unknown>): PlanQaEntry[] {
  const raw = body.plan_qa_list
  if (!Array.isArray(raw)) return []
  const entries: PlanQaEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const question = stringValue(record.question)
    const answer = stringValue(record.answer)
    if (question || answer) entries.push({ question, answer })
  }
  return entries
}

export function parseTaskMetaFromPublishBody(
  body: Record<string, unknown>,
): TaskMetaEntry[] {
  const tasks = Array.isArray(body.tasks) ? body.tasks : []
  const meta: TaskMetaEntry[] = []
  for (const item of tasks) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const taskId = stringField(record, 'task_id')
    if (!taskId) continue
    meta.push({
      task_id: taskId,
      task_type: stringField(record, 'task_type') ?? undefined,
      task_name: stringField(record, 'task_name') ?? undefined,
    })
  }
  return meta
}

export function writeJsonFile(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

export function persistPlanConfig(
  workspace: string,
  config: PlanConfigInfo | null,
): void {
  if (!config) return
  writeJsonFile(join(workspace, PLAN_CONFIG_REL_PATH), config)
}

export function persistPlanDetail(
  workspace: string,
  detail: PlanDetailInfo,
): void {
  writeJsonFile(join(workspace, PLAN_DETAIL_REL_PATH), detail)
}

export function loadPlanConfig(workspace: string): PlanConfigInfo | null {
  return readJsonFile<PlanConfigInfo>(join(workspace, PLAN_CONFIG_REL_PATH))
}

export function loadPlanDetail(workspace: string): PlanDetailInfo | null {
  return readJsonFile<PlanDetailInfo>(join(workspace, PLAN_DETAIL_REL_PATH))
}

export function loadPlanDetailFromPlanId(planId: string): PlanDetailInfo | null {
  return readJsonFile<PlanDetailInfo>(
    join(getPlanWorkspace(planId), 'plan_detail.json'),
  )
}

export function persistPlanLevelDetail(
  planId: string,
  detail: PlanDetailInfo,
): string {
  const planWs = getPlanWorkspace(planId)
  mkdirSync(planWs, { recursive: true })
  const path = join(planWs, 'plan_detail.json')
  writeJsonFile(path, detail)
  return path
}

export function resolveExecutionTimeoutSeconds(
  workspace: string,
  fallbackSeconds: number,
): number {
  return executionTimeoutSecondsFromConfig(
    loadPlanConfig(workspace),
    fallbackSeconds,
  )
}

export type PersistPublishContextInput = {
  taskId: string
  body: Record<string, unknown>
  prdSource?: PrdSourceInput
  ensurePrd?: boolean
}

/**
 * Persists plan_config, plan_detail, task_meta, and optional PRD for a task workspace.
 */
export async function persistTaskPublishContext(
  input: PersistPublishContextInput,
): Promise<void> {
  const workspaceManager = new WorkspaceManager()
  const workspace = workspaceManager.getTaskWorkspace(input.taskId)
  mkdirSync(join(workspace, 'input'), { recursive: true })

  const config = parsePlanConfigInfo(input.body.plan_config_info)
  persistPlanConfig(workspace, config)

  const detail = parsePlanDetailFromBody(input.body)
  if (detail) persistPlanDetail(workspace, detail)

  const taskMeta = parseTaskMetaFromPublishBody(input.body)
  if (taskMeta.length > 0) {
    writeJsonFile(join(workspace, TASK_META_REL_PATH), { tasks: taskMeta })
  }

  if (input.ensurePrd && input.prdSource) {
    const existing = await readPrdFromWorkspace(workspace)
    if (!existing) {
      await fetchPrdToWorkspace(input.prdSource, workspace)
    }
  }

  const planId = stringField(input.body, 'plan_id')
  if (planId) {
    copyUserInstructionFromPlanToTask(planId, workspace, input.taskId)
  }
}

export function prdSourceFromBody(
  body: Record<string, unknown>,
): PrdSourceInput {
  return {
    prd_file_url: stringField(body, 'prd_file_url'),
    prd_md_file_url: stringField(body, 'prd_md_file_url'),
    prd_file_key: stringField(body, 'prd_file_key'),
    prd_md_file_key: stringField(body, 'prd_md_file_key'),
  }
}

export function buildDeviceSchedulerExtraArgs(
  config: PlanConfigInfo | null,
): Record<string, string | number | boolean> {
  if (!config) return {}
  const args: Record<string, string | number | boolean> = {}
  const info = config.device_schedule_info
  if (info && typeof info.max_schedule_device_num === 'number') {
    args['max-schedule-device-num'] = info.max_schedule_device_num
  }
  return args
}

export function buildCaseGenExtraArgs(
  config: PlanConfigInfo | null,
): Record<string, string | number | boolean> {
  if (!config) return {}
  const args: Record<string, string | number | boolean> = {}
  const info = config.case_generate_info
  if (info && typeof info.max_depth === 'number') {
    args['max-depth'] = info.max_depth
  }
  if (info && typeof info.included_case_nums === 'number') {
    args['max-cases'] = info.included_case_nums
  }
  if (typeof config.llm_model_config_id === 'number' && config.llm_model_config_id > 0) {
    args['llm-model-config-id'] = config.llm_model_config_id
  }
  return args
}
