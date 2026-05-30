import { expect, test } from 'bun:test'
import {
  buildReportTaskLogArray,
  extractCaseResultRows,
} from '../server/reportTaskLogFormat.js'

test('extractCaseResultRows supports single object and cases wrapper', () => {
  expect(
    extractCaseResultRows({
      task_id: 't1',
      case_id: 'case-a',
      status: 'pass',
    }).length,
  ).toBe(1)
  expect(
    extractCaseResultRows({
      cases: [{ case_id: 'c1', status: 'pass' }],
    }).length,
  ).toBe(1)
  expect(
    extractCaseResultRows([{ case_id: 'c1', status: 'pass' }]).length,
  ).toBe(1)
})

test('buildReportTaskLogArray uses numeric case_id for report agent', () => {
  const rows = buildReportTaskLogArray(
    {
      task_id: 'exec-1',
      case_index: 1,
      case_id: 'case-agent-test-001',
      case_name: '搜索流程',
      status: 'pass',
      steps_info: [
        {
          step_idx: 1,
          logs: 'ok',
          snapshot: ['case-agent-test-001/screenshots/0001.png'],
        },
      ],
    },
    'exec-1',
  )
  expect(rows.length).toBe(1)
  expect(rows[0]?.case_id).toBe(1)
  expect(Array.isArray(rows[0]?.steps_info)).toBe(true)
  const step = (rows[0]?.steps_info as Record<string, unknown>[])[0]
  expect(step?.snapshot).toEqual(['case-agent-test-001/screenshots/0001.png'])
})
