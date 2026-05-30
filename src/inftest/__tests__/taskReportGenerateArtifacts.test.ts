import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { expect, test } from 'bun:test'
import {
  buildCaseResultFromProxyPayload,
  convertProxyCaseToCaseResultRow,
  enrichTaskReportBodyFromWorkspace,
  parseTaskReportGenerateRequest,
} from '../server/taskReportGenerateArtifacts.js'

test('convertProxyCaseToCaseResultRow maps doc fields', () => {
  const row = convertProxyCaseToCaseResultRow(
    {
      case_id: 'case-001',
      case_name: '登录成功',
      type: 'FUNCTION',
      execution_result: 'SUCCESS',
      test_steps: [{ step: '输入账号', expected: '进入首页' }],
      step_log_info: [{ step_idx: 1, logs: 'ok', snapshot: ['img-key'] }],
      device_id: 'device-001',
      start_time: '2026-05-27 10:00:00',
      end_time: '2026-05-27 10:05:00',
    },
    'task-001',
    0,
  )

  expect(row.case_id).toBe('case-001')
  expect(row.status).toBe('pass')
  expect(row.case_step).toBe('输入账号')
  expect(row.device_id).toBe('device-001')
  expect(Array.isArray(row.steps_info)).toBe(true)
})

test('buildCaseResultFromProxyPayload wraps cases array', () => {
  const payload = buildCaseResultFromProxyPayload(
    {
      cases: [{ case_id: 'c1', case_name: 'Case 1', execution_result: 'FAILED' }],
    },
    'task-001',
  )
  expect(payload.cases.length).toBe(1)
  expect(payload.cases[0]?.status).toBe('fail')
})

test('parseTaskReportGenerateRequest validates exec_id and cases', () => {
  expect(parseTaskReportGenerateRequest({})).toEqual({
    error: '/api/task-report-generate requires exec_id or task_id',
  })
  expect(parseTaskReportGenerateRequest({ exec_id: 't1' })).toEqual({
    error: 'task-report-generate requires a non-empty cases array',
  })

  const parsed = parseTaskReportGenerateRequest({
    exec_id: 'task-001',
    cases: [{ case_id: 'c1', case_name: 'Case 1' }],
    defects: [],
  })
  expect('request' in parsed && parsed.request.exec_id).toBe('task-001')
})

test('enrichTaskReportBodyFromWorkspace fills cases from case_result.json', () => {
  const workspace = join('/tmp', `inftest-report-enrich-${Date.now()}`)
  const resultsDir = join(workspace, 'execution', 'results')
  mkdirSync(resultsDir, { recursive: true })
  writeFileSync(
    join(resultsDir, 'case_result.json'),
    JSON.stringify({
      case_id: 'case-1',
      case_name: '用例',
      status: 'pass',
      expected_result: ['ok'],
      steps_info: [{ step_idx: 1, logs: 'done', snapshot: [] }],
    }),
    'utf8',
  )

  const enriched = enrichTaskReportBodyFromWorkspace({ exec_id: 't1' }, workspace)
  expect(Array.isArray(enriched.cases)).toBe(true)
  expect((enriched.cases as unknown[]).length).toBe(1)
  const first = (enriched.cases as Record<string, unknown>[])[0]
  expect(first?.execution_result).toBe('SUCCESS')
  expect(first?.status).toBe('COMPLETION')
})
