import type { InfTestStage } from '../schemas/task.js'
import type { ProxyAgentStatus, TaskUpdate } from '../schemas/update.js'

/**
 * Internal agent identifiers used across runners/skills, mapped to the proxy
 * AgentName enum defined by the 4.1.3 任务状态上报 contract.
 */
export type InternalAgentName =
  | 'test_generation'
  | 'test_data'
  | 'device_scheduler'
  | 'test_executor'
  | 'result_analyzer'

type EnumMapping = {
  name: string
  number: number
}

const AGENT_NAME_MAP: Record<InternalAgentName, EnumMapping> = {
  test_generation: { name: 'CASE_GENERATION_AGENT', number: 1 },
  test_data: { name: 'TEST_DATA_AGENT', number: 2 },
  device_scheduler: { name: 'DEVICE_SCHEDULING_AGENT', number: 3 },
  test_executor: { name: 'CASE_EXECUTION_AGENT', number: 4 },
  result_analyzer: { name: 'RESULT_ANALYSIS_AGENT', number: 5 },
}

/**
 * AgentStatus numeric values per colleague contract (UpdateTaskStatusRequest):
 * PENDING=0, CHECK=1, RUNNING=1, SUCCESS=3, FAILED=2, PAUSED=4, TERMINATED=5.
 *
 * CHECK and RUNNING both use 1 until P2 aligns with doc (RUNNING=2). The proxy
 * distinguishes them by stage context and step_log.
 */
const PROXY_AGENT_STATUS_MAP: Record<ProxyAgentStatus, EnumMapping> = {
  PENDING: { name: 'PENDING', number: 0 },
  CHECK: { name: 'CHECK', number: 1 },
  RUNNING: { name: 'RUNNING', number: 1 },
  FAILED: { name: 'FAILED', number: 2 },
  SUCCESS: { name: 'SUCCESS', number: 3 },
  PAUSED: { name: 'PAUSED', number: 4 },
  TERMINATED: { name: 'TERMINATED', number: 5 },
}

const INTERNAL_TO_PROXY_STATUS: Partial<
  Record<NonNullable<TaskUpdate['task_status']>, ProxyAgentStatus>
> = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  PAUSED: 'PAUSED',
  TERMINATED: 'TERMINATED',
}

const STAGE_TO_AGENT: Partial<Record<InfTestStage, InternalAgentName>> = {
  DATA_GEN: 'test_generation',
  COORDINATE: 'device_scheduler',
  EXECUTING: 'test_executor',
  REFLECTING: 'result_analyzer',
}

export type ProxyEnumFormat = 'string' | 'int'

export function getProxyEnumFormat(): ProxyEnumFormat {
  const raw = process.env.INFTEST_PROXY_STATUS_ENUM_FORMAT?.trim().toLowerCase()
  if (raw === 'string' || raw === 'name') return 'string'
  return 'int'
}

function formatEnum(
  mapping: EnumMapping | undefined,
  format: ProxyEnumFormat,
): string | number | undefined {
  if (!mapping) return undefined
  return format === 'int' ? mapping.number : mapping.name
}

export function resolveAgentName(
  update: Pick<TaskUpdate, 'agent_name' | 'current_stage'>,
): InternalAgentName | undefined {
  if (update.agent_name && update.agent_name in AGENT_NAME_MAP) {
    return update.agent_name as InternalAgentName
  }
  if (update.current_stage) {
    return STAGE_TO_AGENT[update.current_stage]
  }
  return undefined
}

/** Proxy status after stop_after_stage partial completion (internal session stays PAUSED). */
export function mapPartialStopProxyStatus(stage: InfTestStage): ProxyAgentStatus {
  if (stage === 'DATA_GEN') return 'CHECK'
  if (stage === 'EXECUTING') return 'PAUSED'
  return 'PAUSED'
}

function resolveProxyStatus(update: TaskUpdate): ProxyAgentStatus {
  if (update.proxy_status) return update.proxy_status
  if (update.task_status) {
    const mapped = INTERNAL_TO_PROXY_STATUS[update.task_status]
    if (mapped) return mapped
  }
  throw new Error(
    'UpdateTaskStatusRequest requires agent_status (task_status or proxy_status)',
  )
}

/**
 * Strict outbound JSON for POST /api/proxy-update-task-status (UpdateTaskStatusRequest).
 * Proxy unmarshals agent_name and agent_status as int; all eight fields are always sent.
 */
export type UpdateTaskStatusPayload = {
  task_id: string
  agent_name: number
  agent_status: number
  total_tokens: number
  output_json: string
  step_log: string
  start_time: string
  end_time: string
}

function formatProxyTime(value: string | undefined): string {
  if (!value?.trim()) return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value.trim()
  return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function buildUpdateTaskStatusPayload(
  update: TaskUpdate,
  format: ProxyEnumFormat = getProxyEnumFormat(),
): UpdateTaskStatusPayload {
  const agentInternal = resolveAgentName(update)
  if (!agentInternal) {
    throw new Error(
      'UpdateTaskStatusRequest requires agent_name: no AgentName mapping for this stage',
    )
  }

  const proxyStatus = resolveProxyStatus(update)
  const agentEnum = formatEnum(AGENT_NAME_MAP[agentInternal], format)
  const statusEnum = formatEnum(PROXY_AGENT_STATUS_MAP[proxyStatus], format)
  if (typeof agentEnum !== 'number' || typeof statusEnum !== 'number') {
    throw new Error(
      'Proxy UpdateTaskStatusRequest requires numeric agent_name and agent_status (set INFTEST_PROXY_STATUS_ENUM_FORMAT=int)',
    )
  }

  const startTime = formatProxyTime(update.start_time)
  const endTime = formatProxyTime(
    update.end_time ??
      (proxyStatus === 'RUNNING' ? update.start_time : undefined),
  )

  return {
    task_id: update.task_id,
    agent_name: agentEnum,
    agent_status: statusEnum,
    total_tokens:
      typeof update.total_tokens === 'number' && update.total_tokens >= 0
        ? update.total_tokens
        : 0,
    output_json: update.output_json ?? '',
    step_log: update.step_log ?? update.message ?? '',
    start_time: startTime,
    end_time: endTime,
  }
}
