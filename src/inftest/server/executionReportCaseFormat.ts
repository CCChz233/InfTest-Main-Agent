/**
 * Maps workspace execution artifacts to task-report-generate / proxy case shape (interface doc L335–365).
 */

export type DocFormatTestStep = {
  id: number
  step: string
  expected: string
}

export type DocFormatCase = {
  case_id: string
  type: string
  case_name: string
  preconditions: string
  test_steps: DocFormatTestStep[]
  status: 'COMPLETION'
  execution_result: 'SUCCESS' | 'FAILED'
  retry_count: number
  failure_reason: string
  step_log_info: Array<{
    step_idx: number
    logs: string
    snapshot: string[]
  }>
  device_id?: string
  start_time?: string
  end_time?: string
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  return typeof value === 'string' ? value.trim() : ''
}

function isPassStatus(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  return ['pass', 'passed', 'success', 'completion'].includes(normalized)
}

function stepsInfoToTestSteps(
  stepsInfo: unknown[],
  expectedResult: string[],
): DocFormatTestStep[] {
  if (stepsInfo.length > 0) {
    return stepsInfo.map((item, index) => {
      const record =
        item && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : {}
      const stepIdx = Number(record.step_idx ?? record.step ?? index + 1)
      const logs = stringField(record, 'logs')
      const expected =
        expectedResult[index] ??
        stringField(record, 'expected') ??
        stringField(record, 'snapshot') ??
        ''
      return {
        id: stepIdx,
        step: logs || `步骤 ${stepIdx}`,
        expected,
      }
    })
  }

  return expectedResult.map((expected, index) => ({
    id: index + 1,
    step: `步骤 ${index + 1}`,
    expected,
  }))
}

function stepsInfoToStepLogInfo(stepsInfo: unknown[]): DocFormatCase['step_log_info'] {
  return stepsInfo
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .map((item, index) => {
      const record = item as Record<string, unknown>
      const stepIdx = Number(record.step_idx ?? record.step ?? index + 1)
      const snapshotRaw = record.snapshot
      const snapshot = Array.isArray(snapshotRaw)
        ? snapshotRaw.map(value => String(value))
        : snapshotRaw
          ? [String(snapshotRaw)]
          : []
      return {
        step_idx: stepIdx,
        logs: stringField(record, 'logs'),
        snapshot,
      }
    })
}

export function caseResultRowToDocCase(row: Record<string, unknown>): DocFormatCase {
  const pass = isPassStatus(row.status)
  const expectedResult = Array.isArray(row.expected_result)
    ? row.expected_result.map(value => String(value))
    : []
  const stepsInfo = Array.isArray(row.steps_info) ? row.steps_info : []
  const caseStepText = stringField(row, 'case_step')
  const testSteps =
    stepsInfo.length > 0 || expectedResult.length > 0
      ? stepsInfoToTestSteps(stepsInfo, expectedResult)
      : caseStepText
        ? caseStepText.split('\n').filter(Boolean).map((step, index) => ({
            id: index + 1,
            step,
            expected: expectedResult[index] ?? '',
          }))
        : []

  return {
    case_id: stringField(row, 'case_id') || 'case-unknown',
    type: stringField(row, 'type') || 'FUNCTION',
    case_name: stringField(row, 'case_name') || stringField(row, 'case_id') || 'case',
    preconditions: stringField(row, 'preconditions'),
    test_steps: testSteps,
    status: 'COMPLETION',
    execution_result: pass ? 'SUCCESS' : 'FAILED',
    retry_count: typeof row.retry_count === 'number' ? row.retry_count : 0,
    failure_reason: stringField(row, 'failure_reason'),
    step_log_info: stepsInfoToStepLogInfo(stepsInfo),
    ...(stringField(row, 'device_id') ? { device_id: stringField(row, 'device_id') } : {}),
    ...(stringField(row, 'start_time') ? { start_time: stringField(row, 'start_time') } : {}),
    ...(stringField(row, 'end_time') ? { end_time: stringField(row, 'end_time') } : {}),
  }
}

export function parseCaseResultPayload(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>
  if (Array.isArray(record.cases)) {
    return record.cases
      .filter(item => item && typeof item === 'object' && !Array.isArray(item))
      .map(item => item as Record<string, unknown>)
  }
  if (record.case_id || record.case_name) {
    return [record]
  }
  return []
}

export function caseResultPayloadToDocCases(payload: unknown): DocFormatCase[] {
  return parseCaseResultPayload(payload).map(caseResultRowToDocCase)
}
