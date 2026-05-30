import { expect, test } from 'bun:test'
import {
  caseResultPayloadToDocCases,
  caseResultRowToDocCase,
} from '../server/executionReportCaseFormat.js'

test('caseResultRowToDocCase maps execution row to interface doc shape', () => {
  const doc = caseResultRowToDocCase({
    case_id: 'case-1',
    type: 'FUNCTION',
    case_name: '登录',
    preconditions: '已安装',
    status: 'pass',
    expected_result: ['首页', '个人中心'],
    steps_info: [
      { step_idx: 1, logs: '点击登录', snapshot: ['a.png'] },
      { step_idx: 2, logs: '进入首页', snapshot: [] },
    ],
    retry_count: 0,
    failure_reason: '',
    device_id: 'dev-1',
  })

  expect(doc.status).toBe('COMPLETION')
  expect(doc.execution_result).toBe('SUCCESS')
  expect(doc.test_steps).toHaveLength(2)
  expect(doc.test_steps[0]).toEqual({
    id: 1,
    step: '点击登录',
    expected: '首页',
  })
  expect(doc.step_log_info[0]).toEqual({
    step_idx: 1,
    logs: '点击登录',
    snapshot: ['a.png'],
  })
})

test('caseResultPayloadToDocCases reads single-object case_result.json', () => {
  const cases = caseResultPayloadToDocCases({
    case_id: 'c1',
    status: 'fail',
    failure_reason: 'timeout',
    steps_info: [],
    expected_result: [],
  })
  expect(cases).toHaveLength(1)
  expect(cases[0]?.execution_result).toBe('FAILED')
})
