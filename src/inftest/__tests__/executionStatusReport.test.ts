import { expect, test } from 'bun:test'
import {
  buildExecutionStatusReportFromCaseResultJson,
  compactJsonString,
  extractTotalTokensFromCaseResult,
} from '../adapters/executionStatusReport.js'
import { buildUpdateTaskStatusPayload } from '../adapters/updateTaskStatusPayload.js'

test('buildExecutionStatusReportFromCaseResultJson matches colleague example shape', () => {
  const caseResult = {
    task_id: 'exec-agent-test-001',
    case_id: 'case-agent-test-001',
    status: 'pass',
    token_consumption: {
      total: { total_tokens: 22921 },
    },
  }
  const report = buildExecutionStatusReportFromCaseResultJson(
    JSON.stringify(caseResult, null, 2),
    'Execution agent completed',
  )
  expect(report.step_log).toBe('Execution agent completed')
  expect(report.total_tokens).toBe(22921)
  expect(report.output_json).toBe(compactJsonString(JSON.stringify(caseResult, null, 2)))
  expect(report.output_json).toContain('"case_id":"case-agent-test-001"')
})

test('buildUpdateTaskStatusPayload emits colleague int enums for execution SUCCESS', () => {
  process.env.INFTEST_PROXY_STATUS_ENUM_FORMAT = 'int'
  const caseResult = JSON.stringify({
    case_id: 'case-1',
    status: 'pass',
    token_consumption: { total: { total_tokens: 100 } },
  })
  const report = buildExecutionStatusReportFromCaseResultJson(caseResult)
  const payload = buildUpdateTaskStatusPayload({
    event_id: 'e1',
    task_id: 'exec-agent-test-001',
    agent_name: 'test_executor',
    task_status: 'SUCCESS',
    proxy_status: 'SUCCESS',
    total_tokens: report.total_tokens,
    output_json: report.output_json,
    step_log: report.step_log,
    start_time: '2026-05-30T04:43:15Z',
    end_time: '2026-05-30T04:47:56Z',
    stage_operations: [],
    case_node_operations: [],
    case_detail_operations: [],
  })
  expect(payload.agent_name).toBe(4)
  expect(payload.agent_status).toBe(3)
  expect(payload.total_tokens).toBe(100)
  expect(payload.step_log).toBe('Execution agent completed')
  expect(payload.output_json).toContain('"case_id":"case-1"')
  expect(Object.keys(payload).sort()).toEqual(
    [
      'agent_name',
      'agent_status',
      'end_time',
      'output_json',
      'start_time',
      'step_log',
      'task_id',
      'total_tokens',
    ].sort(),
  )
})

test('extractTotalTokensFromCaseResult returns 0 when missing', () => {
  expect(extractTotalTokensFromCaseResult({})).toBe(0)
})
