import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { parseTestSteps } from './casePublishArtifacts.js'
import {
  caseResultPayloadToDocCases,
  type DocFormatCase,
} from './executionReportCaseFormat.js'
import {
  buildReportTaskLogArray,
  extractCaseResultRows,
} from './reportTaskLogFormat.js'

export type TaskReportCaseInput = Record<string, unknown>

export type TaskReportGenerateRequest = {
  exec_id: string
  plan_id: string | null
  plan_name: string | null
  task_name: string | null
  md_file_key: string | null
  cases: TaskReportCaseInput[]
  defects: unknown[]
  raw: Record<string, unknown>
}

function stringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeExecutionStatus(value: unknown): 'pass' | 'fail' {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (['SUCCESS', 'PASS', 'PASSED', 'COMPLETION'].includes(normalized)) {
    return 'pass'
  }
  return 'fail'
}

function buildStepsInfo(raw: TaskReportCaseInput): Array<Record<string, unknown>> {
  const stepLogInfo = raw.step_log_info
  if (Array.isArray(stepLogInfo) && stepLogInfo.length > 0) {
    return stepLogInfo
      .filter(item => item && typeof item === 'object' && !Array.isArray(item))
      .map((item, index) => {
        const record = item as Record<string, unknown>
        const stepIdx = Number(record.step_idx ?? index + 1)
        const logs = stringField(record, 'logs') ?? ''
        const snapshot = Array.isArray(record.snapshot)
          ? record.snapshot.map(value => String(value))
          : []
        return {
          step: stepIdx,
          logs,
          snapshot,
          status: normalizeExecutionStatus(record.status ?? 'SUCCESS') === 'pass'
            ? 'passed'
            : 'failed',
        }
      })
  }

  const { case_step, expected_result } = parseTestSteps(raw.test_steps)
  return case_step.map((step, index) => ({
    step: index + 1,
    logs: step,
    snapshot: expected_result[index] ?? '',
    status: 'passed',
  }))
}

export function convertProxyCaseToCaseResultRow(
  raw: TaskReportCaseInput,
  taskId: string,
  index: number,
): Record<string, unknown> {
  const caseId = stringField(raw, 'case_id') ?? `case_${index + 1}`
  const caseName = stringField(raw, 'case_name') ?? caseId
  const { case_step, expected_result } = parseTestSteps(raw.test_steps)
  const stepsInfo = buildStepsInfo(raw)
  const pass = normalizeExecutionStatus(raw.execution_result ?? raw.status) === 'pass'
  const expectedText =
    expected_result.length > 0 ? expected_result.join('；') : '预期结果通过'

  return {
    task_id: taskId,
    case_index: index + 1,
    case_id: caseId,
    case_name: caseName,
    test_type: stringField(raw, 'type')?.toLowerCase() ?? 'functional',
    case_step: case_step.join('\n'),
    expected_result,
    status: pass ? 'pass' : 'fail',
    device_id: stringField(raw, 'device_id'),
    start_time: stringField(raw, 'start_time'),
    end_time: stringField(raw, 'end_time'),
    retry_count: raw.retry_count ?? 0,
    failure_reason: stringField(raw, 'failure_reason') ?? '',
    steps_info: stepsInfo,
    functional: {
      status: pass ? 'passed' : 'failed',
      test_type: stringField(raw, 'type')?.toLowerCase() ?? 'functional',
      scene: stringField(raw, 'test_scenario') ?? caseName,
      expected_result: expectedText,
      actual_result: pass
        ? 'Execution completed successfully.'
        : stringField(raw, 'failure_reason') ?? 'Execution failed.',
      failure_attribution: '',
      failure_attribution_rationale: '',
      failure_attribution_confidence: '',
      issue_root_type: '',
      issue_root_type_label: '',
      functional_problem_summary: stringField(raw, 'failure_reason') ?? '',
      failure_symptom_type: '',
    },
    screenshots_analysis: [],
    issues_found: [],
    risk_level: pass ? 'low' : 'high',
  }
}

export function buildCaseResultFromProxyPayload(
  body: Record<string, unknown>,
  taskId: string,
): { cases: Record<string, unknown>[] } {
  const cases = Array.isArray(body.cases) ? body.cases : []
  return {
    cases: cases.map((item, index) =>
      convertProxyCaseToCaseResultRow(
        item && typeof item === 'object' && !Array.isArray(item)
          ? (item as TaskReportCaseInput)
          : {},
        taskId,
        index,
      ),
    ),
  }
}

export function loadDocCasesFromWorkspace(workspace: string): DocFormatCase[] {
  const path = join(workspace, 'execution', 'results', 'case_result.json')
  if (!existsSync(path)) return []
  try {
    const payload = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return caseResultPayloadToDocCases(payload)
  } catch {
    return []
  }
}

/** Fill cases[] from execution/results/case_result.json when proxy omits cases. */
export function enrichTaskReportBodyFromWorkspace(
  body: Record<string, unknown>,
  workspace: string,
): Record<string, unknown> {
  const existing = Array.isArray(body.cases) ? body.cases : []
  if (existing.length > 0) return body
  const fromDisk = loadDocCasesFromWorkspace(workspace)
  if (fromDisk.length === 0) return body
  return { ...body, cases: fromDisk }
}

export function parseTaskReportGenerateRequest(
  body: Record<string, unknown>,
): { request: TaskReportGenerateRequest } | { error: string } {
  const execId = stringField(body, 'exec_id') ?? stringField(body, 'task_id')
  if (!execId) {
    return { error: '/api/task-report-generate requires exec_id or task_id' }
  }

  const cases = Array.isArray(body.cases) ? body.cases : []
  if (cases.length === 0) {
    return { error: 'task-report-generate requires a non-empty cases array' }
  }

  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index]
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { error: `cases[${index}] must be an object` }
    }
    const record = item as Record<string, unknown>
    if (!stringField(record, 'case_id')) {
      return { error: `cases[${index}].case_id is required` }
    }
    if (!stringField(record, 'case_name')) {
      return { error: `cases[${index}].case_name is required` }
    }
  }

  return {
    request: {
      exec_id: execId,
      plan_id: stringField(body, 'plan_id'),
      plan_name: stringField(body, 'plan_name'),
      task_name: stringField(body, 'task_name'),
      md_file_key: stringField(body, 'md_file_key'),
      cases: cases as TaskReportCaseInput[],
      defects: Array.isArray(body.defects) ? body.defects : [],
      raw: body,
    },
  }
}

function caseResultHasExecutionSteps(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    const rows = extractCaseResultRows(
      JSON.parse(readFileSync(path, 'utf8')) as unknown,
    )
    return rows.some(row => {
      const steps = row.steps_info
      return Array.isArray(steps) && steps.length > 0
    })
  } catch {
    return false
  }
}

export function persistTaskReportGenerateArtifacts(
  workspace: string,
  body: Record<string, unknown>,
  taskId: string,
): void {
  mkdirSync(join(workspace, 'input'), { recursive: true })
  mkdirSync(join(workspace, 'execution', 'results'), { recursive: true })

  writeFileSync(
    join(workspace, 'input', 'task_report_generate_request.json'),
    `${JSON.stringify(body, null, 2)}\n`,
    'utf8',
  )
  writeFileSync(
    join(workspace, 'input', 'defects.json'),
    `${JSON.stringify(Array.isArray(body.defects) ? body.defects : [], null, 2)}\n`,
    'utf8',
  )
  writeFileSync(
    join(workspace, 'input', 'report_requirement.json'),
    `${JSON.stringify(
      {
        md_file_key: stringField(body, 'md_file_key'),
        plan_id: stringField(body, 'plan_id'),
        plan_name: stringField(body, 'plan_name'),
        task_name: stringField(body, 'task_name'),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  const caseResultPath = join(workspace, 'execution', 'results', 'case_result.json')
  const proxyCaseResult = buildCaseResultFromProxyPayload(body, taskId)
  if (!caseResultHasExecutionSteps(caseResultPath)) {
    writeFileSync(
      caseResultPath,
      `${JSON.stringify(proxyCaseResult, null, 2)}\n`,
      'utf8',
    )
  }

  const reportSource =
    caseResultHasExecutionSteps(caseResultPath) ?
      JSON.parse(readFileSync(caseResultPath, 'utf8')) as unknown
    : proxyCaseResult
  const reportTaskLog = buildReportTaskLogArray(reportSource, taskId)
  if (reportTaskLog.length === 0) {
    throw new Error('task-report-generate: no cases available for report_task_log.json')
  }
  writeFileSync(
    join(workspace, 'execution', 'results', 'report_task_log.json'),
    `${JSON.stringify(reportTaskLog, null, 2)}\n`,
    'utf8',
  )
}
