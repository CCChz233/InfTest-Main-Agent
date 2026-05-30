import { expect, test } from 'bun:test'
import { validCasePublishBody } from './casePublishDocFixtures.js'
import {
  buildDocFormatCasePublishArtifact,
  casePublishCaseToManualCase,
  casePublishCaseToParsedCase,
  normalizeDocSteps,
  parseCasePublishCases,
  parseStructuredSteps,
  parseTestSteps,
  readExecutableCasesFromTestCases,
  validateCasePublishBody,
} from '../server/casePublishArtifacts.js'

test('parseTestSteps supports string and object steps', () => {
  expect(parseTestSteps(['打开 APP', '点击搜索'])).toEqual({
    case_step: ['打开 APP', '点击搜索'],
    expected_result: [],
  })

  expect(
    parseTestSteps([
      { step: '点击搜索', expected: '出现结果' },
      { action: '输入关键字', expected_result: '列表刷新' },
    ]),
  ).toEqual({
    case_step: ['点击搜索', '输入关键字'],
    expected_result: ['出现结果', '列表刷新'],
  })
})

test('parseStructuredSteps preserves step_id from doc format', () => {
  expect(
    parseStructuredSteps([
      { step_id: '1.1.1', action: '退到桌面', expected: '成功退到桌面' },
      { step_id: '1.1.2', action: '打开 APP', expected: '进入首页' },
    ]),
  ).toEqual([
    { step_id: '1.1.1', action: '退到桌面', expected: '成功退到桌面' },
    { step_id: '1.1.2', action: '打开 APP', expected: '进入首页' },
  ])
})

test('normalizeDocSteps always emits step_id, action, expected', () => {
  expect(normalizeDocSteps([{ action: 'a', expected: 'e' }])).toEqual([
    { step_id: '1', action: 'a', expected: 'e' },
  ])
})

test('casePublishCaseToManualCase maps legacy doc fields', () => {
  const manual = casePublishCaseToManualCase({
    case_id: 'case-001',
    case_name: '登录成功',
    type: 'FUNCTION',
    preconditions: '用户已注册',
    test_steps: [{ step: '输入账号', expected: '进入首页' }],
  })

  expect(manual.case_id).toBe('case-001')
  expect(manual.case_name).toBe('登录成功')
  expect(manual.case_step).toEqual(['输入账号'])
  expect(manual.expected_result).toEqual(['进入首页'])
})

test('casePublishCaseToParsedCase maps interface doc L267-313 format', () => {
  const parsed = casePublishCaseToParsedCase({
    case_id: 'case-xxx',
    title: '用例名称',
    conditions: '前置条件',
    steps: [
      { step_id: '1.1.1', action: '退到桌面', expected: '成功退到桌面' },
      { step_id: '1.1.2', action: '打开掌上新华APP', expected: 'APP成功启动并进入首页' },
      { step_id: '1.1.3', action: '点击首页搜索框', expected: '搜索框可正常聚焦并输入' },
      {
        step_id: '1.1.4',
        action: '输入关键字“健康”并执行搜索',
        expected: '返回包含关键字相关的搜索结果',
      },
    ],
  })

  expect(parsed.manual.case_name).toBe('用例名称')
  expect(parsed.conditions).toBe('前置条件')
  expect(parsed.manual.case_step).toHaveLength(4)
  expect(parsed.structured_steps[0]?.step_id).toBe('1.1.1')
})

test('parseCasePublishCases enforces strict doc fields', () => {
  expect(parseCasePublishCases([])).toEqual({
    error: 'case-publish requires a non-empty cases array',
  })
  expect(parseCasePublishCases([{ title: 'x' }])).toEqual({
    error: 'cases[0].case_id is required',
  })
  expect(parseCasePublishCases([{ case_id: 'c1' }])).toEqual({
    error: 'cases[0].title is required',
  })
  expect(
    parseCasePublishCases([
      { case_id: 'c1', title: 'Case 1', conditions: '前置' },
    ]),
  ).toEqual({
    error: 'cases[0].steps must be a non-empty array',
  })

  const parsed = parseCasePublishCases([
    {
      case_id: 'c1',
      title: 'Case 1',
      conditions: '',
      steps: [{ step_id: '1.1.1', action: 'step1', expected: 'ok' }],
    },
  ])
  expect('cases' in parsed && parsed.cases.length).toBe(1)
})

test('validateCasePublishBody requires full doc envelope', () => {
  expect(validateCasePublishBody(validCasePublishBody())).toBeNull()
  expect(validateCasePublishBody({})).toContain('plan_id')
  expect(validateCasePublishBody(validCasePublishBody({ plan_detail: {} }))).toContain(
    'plan_detail',
  )
})

test('buildDocFormatCasePublishArtifact matches interface doc envelope', () => {
  const body = validCasePublishBody()
  const parsed = parseCasePublishCases(body.cases)
  expect('cases' in parsed).toBe(true)
  if (!('cases' in parsed)) return

  const artifact = buildDocFormatCasePublishArtifact(body, parsed.cases, {
    plan_id: 'plan-1',
    exec_id: 'task-1',
    plan_name: 'Plan',
  })

  expect(artifact.plan_id).toBe('plan-1')
  expect(artifact.exec_id).toBe('task-1')
  expect(artifact.test_strategies).toEqual(['FUNCTIONAL'])
  expect(artifact.cases[0]?.title).toBe('用例名称')
  expect(artifact.cases[0]?.conditions).toBe('前置条件')
  expect(artifact.cases[0]?.steps[0]).toEqual({
    step_id: '1.1.1',
    action: '退到桌面',
    expected: '成功退到桌面',
  })
  expect(Object.keys(artifact).sort()).toEqual(
    [
      'cases',
      'exec_id',
      'plan_config_info',
      'plan_detail',
      'plan_id',
      'plan_name',
      'test_env_url',
      'test_strategies',
    ].sort(),
  )
})

test('readExecutableCasesFromTestCases supports tree steps and doc cases', () => {
  const fromTree = readExecutableCasesFromTestCases({
    root: {
      children: [
        {
          node_id: 'c-tree',
          title: 'Tree case',
          steps: [{ action: '点击', expected: '成功' }],
          expected_result: ['成功'],
        },
      ],
    },
  })
  expect(fromTree.map(item => item.case_id)).toEqual(['c-tree'])
  expect(fromTree[0]?.case_step).toEqual(['点击'])

  const fromDoc = readExecutableCasesFromTestCases(validCasePublishBody())
  expect(fromDoc.map(item => item.case_id)).toEqual(['case-demo-001'])
})

test('readExecutableCasesFromTestCases roundtrips doc-format test_cases.json', () => {
  const body = validCasePublishBody({
    cases: [
      {
        case_id: 'c-roundtrip',
        title: 'Roundtrip',
        conditions: '',
        steps: [
          { step_id: '1.1.1', action: 'a1', expected: 'e1' },
          { step_id: '1.1.2', action: 'a2', expected: 'e2' },
        ],
      },
    ],
  })
  const parsed = parseCasePublishCases(body.cases)
  expect('cases' in parsed).toBe(true)
  if (!('cases' in parsed)) return

  const artifact = buildDocFormatCasePublishArtifact(body, parsed.cases, {
    exec_id: 'task-1',
  })
  const executable = readExecutableCasesFromTestCases(artifact)
  expect(executable[0]?.case_step).toEqual(['a1', 'a2'])
  expect(executable[0]?.expected_result).toEqual(['e1', 'e2'])
})
