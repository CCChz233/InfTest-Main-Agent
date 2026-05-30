/**
 * Report agent expects --log-file as a JSON **array** of task rows with numeric
 * case_id, status, and steps_info (see report_agent/services/log_parsing.py).
 */

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  return typeof value === 'string' ? value.trim() : ''
}

function isPassStatus(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  return ['pass', 'passed', 'success', 'completion', 'ok'].includes(normalized)
}

/** Extract per-case rows from execution case_result.json shapes. */
export function extractCaseResultRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    )
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return []
  }
  const record = payload as Record<string, unknown>
  if (Array.isArray(record.cases)) {
    return record.cases.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    )
  }
  if ('case_id' in record || 'task_id' in record || 'case_index' in record) {
    return [record]
  }
  return []
}

function resolveNumericCaseId(
  row: Record<string, unknown>,
  fallbackIndex: number,
): number {
  const caseIndex = Number(row.case_index)
  if (Number.isFinite(caseIndex) && caseIndex > 0) {
    return Math.trunc(caseIndex)
  }
  const raw = row.case_id
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.trunc(raw)
  }
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    return Number(raw.trim())
  }
  return fallbackIndex
}

function normalizeSnapshot(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item)).filter(Boolean)
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
  }
  return []
}

/** steps_info shape for report_agent structured task log. */
export function normalizeStepsInfoForReport(
  steps: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(steps)) return []
  return steps
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .map((item, index) => {
      const record = item as Record<string, unknown>
      const stepIdx = Number(record.step_idx ?? record.step ?? index + 1)
      const logs = stringField(record, 'logs')
      const snapshot = normalizeSnapshot(record.snapshot)
      const statusRaw = String(record.status ?? '').toLowerCase()
      const status =
        statusRaw === 'failed' || statusRaw === 'fail' ? 'failed' : 'passed'
      return {
        step: stepIdx,
        logs,
        snapshot,
        status,
      }
    })
}

export function buildReportTaskLogRow(
  row: Record<string, unknown>,
  taskId: string,
  index: number,
): Record<string, unknown> {
  const caseIndex = resolveNumericCaseId(row, index + 1)
  const pass = isPassStatus(row.status ?? row.execution_result)
  const stepsInfo = normalizeStepsInfoForReport(
    row.steps_info ?? row.step_log_info,
  )
  const expectedResult = Array.isArray(row.expected_result)
    ? row.expected_result.map(value => String(value))
    : []

  return {
    task_id: stringField(row, 'task_id') || taskId,
    case_index: caseIndex,
    case_id: caseIndex,
    case_name:
      stringField(row, 'case_name') ||
      stringField(row, 'case_step') ||
      `案例${caseIndex}`,
    test_type: stringField(row, 'test_type') || 'functional',
    case_step: typeof row.case_step === 'string' ? row.case_step : '',
    expected_result: expectedResult,
    status: pass ? 'pass' : 'fail',
    device_id: row.device_id ?? null,
    start_time: row.start_time ?? null,
    end_time: row.end_time ?? null,
    retry_count: row.retry_count ?? 0,
    failure_reason: stringField(row, 'failure_reason'),
    steps_info: stepsInfo,
    reason: stringField(row, 'reason'),
    time: stringField(row, 'time'),
    device: row.device ?? null,
    token_consumption: row.token_consumption ?? null,
  }
}

export function buildReportTaskLogArray(
  payload: unknown,
  taskId: string,
): Record<string, unknown>[] {
  return extractCaseResultRows(payload).map((row, index) =>
    buildReportTaskLogRow(row, taskId, index),
  )
}
