import { expect, test } from 'bun:test'
import {
  buildCaseGenExtraArgs,
  parsePlanDetailFromBody,
  parsePlanQaList,
  parseTaskMetaFromPublishBody,
} from '../server/planContextArtifacts.js'
import {
  executionTimeoutSecondsFromConfig,
  parsePlanConfigInfo,
} from '../schemas/planConfig.js'

test('parsePlanConfigInfo accepts doc-shaped config', () => {
  const config = parsePlanConfigInfo({
    case_execution_info: { max_timeout_minutes: 5 },
    case_generate_info: { max_depth: 3, included_case_nums: 20 },
  })
  expect(config?.case_execution_info?.max_timeout_minutes).toBe(5)
  expect(config?.case_generate_info?.included_case_nums).toBe(20)
})

test('executionTimeoutSecondsFromConfig converts minutes to seconds', () => {
  const seconds = executionTimeoutSecondsFromConfig(
    parsePlanConfigInfo({
      case_execution_info: { max_timeout_minutes: 5 },
    }),
    900,
  )
  expect(seconds).toBe(300)
})

test('parsePlanDetailFromBody maps seven sections', () => {
  const detail = parsePlanDetailFromBody({
    plan_detail: {
      test_objectives: 'obj',
      test_scope: 'scope',
      test_target: 'target',
      test_environment: 'env',
      resources: 'res',
      schedule: 'sched',
      deliverables: 'del',
    },
  })
  expect(detail?.test_objectives).toBe('obj')
  expect(detail?.deliverables).toBe('del')
})

test('parsePlanQaList and task meta from publish body', () => {
  const qa = parsePlanQaList({
    plan_qa_list: [{ question: 'Q1', answer: 'A1' }],
  })
  expect(qa).toHaveLength(1)
  const meta = parseTaskMetaFromPublishBody({
    tasks: [{ task_id: 't1', task_type: 'FUNCTION' }],
  })
  expect(meta[0]?.task_type).toBe('FUNCTION')
})

test('buildCaseGenExtraArgs maps case_generate_info', () => {
  const args = buildCaseGenExtraArgs(
    parsePlanConfigInfo({
      case_generate_info: { max_depth: 4, included_case_nums: 10 },
      llm_model_config_id: 7,
    }),
  )
  expect(args['max-depth']).toBe(4)
  expect(args['max-cases']).toBe(10)
})
