import type { PlanDag } from '../schemas/plan.js'

export type ManualCase = {
  case_id: string
  case_name: string
  test_type: 'functional'
  case_function_point: string
  test_scenario: string
  case_step: string[]
  expected_result: string[]
}

export function buildManualCases(taskId: string): ManualCase[] {
  return [
    {
      case_id: `${taskId}_case_000`,
      case_name: '首页搜索-健康关键词常规流程',
      test_type: 'functional',
      case_function_point: '首页搜索',
      test_scenario: '常规搜索流程',
      case_step: [
        '退到桌面',
        '打开掌上新华APP',
        '点击首页搜索框',
        '输入关键字“健康”并执行搜索',
      ],
      expected_result: [
        '成功退到桌面',
        'APP成功启动并进入首页',
        '搜索框可正常聚焦并输入',
        '返回包含关键字相关的搜索结果列表',
      ],
    },
  ]
}

export function buildPlanDag(taskId: string): PlanDag {
  return {
    task_id: taskId,
    version: 'stateful-runner-v1',
    nodes: [
      {
        id: 'plan',
        stage: 'PLANNING',
        title: 'Create test plan DAG',
      },
      {
        id: 'static_case_generation',
        stage: 'DATA_GEN',
        title: 'Load static test cases',
        depends_on: ['plan'],
      },
      {
        id: 'device_coordinate',
        stage: 'COORDINATE',
        title: 'Bind cases to a device',
        depends_on: ['static_case_generation'],
      },
      {
        id: 'execute_cases',
        stage: 'EXECUTING',
        title: 'Invoke execution agent CLI adapter',
        depends_on: ['device_coordinate'],
      },
      {
        id: 'generate_report',
        stage: 'REFLECTING',
        title: 'Invoke report agent CLI adapter',
        depends_on: ['execute_cases'],
      },
      {
        id: 'finalize',
        stage: 'COMPLETED',
        title: 'Finalize task status',
        depends_on: ['generate_report'],
      },
    ],
    edges: [
      { from: 'plan', to: 'static_case_generation' },
      { from: 'static_case_generation', to: 'device_coordinate' },
      { from: 'device_coordinate', to: 'execute_cases' },
      { from: 'execute_cases', to: 'generate_report' },
      { from: 'generate_report', to: 'finalize' },
    ],
  }
}

export function buildManualTestCasesArtifact(cases: ManualCase[]): unknown {
  return {
    source: 'manual_static_plan',
    reason: 'data_generation_agent_deferred_in_v1',
    root: {
      node_id: 'root',
      title: '掌上新华 APP 首页搜索测试',
      children: cases.map(testCase => ({
        node_id: testCase.case_id,
        title: testCase.case_name,
        type: 'CASE',
        test_type: testCase.test_type,
        case_function_point: testCase.case_function_point,
        test_scenario: testCase.test_scenario,
        preconditions: [
          '测试设备已连接并可被执行 Agent 调度',
          '掌上新华 APP 已安装且可正常启动',
          '网络环境可访问掌上新华服务',
        ],
        test_steps: testCase.case_step,
        expected_result: testCase.expected_result,
      })),
    },
  }
}

export function buildDeviceCaseBindArtifact(
  deviceId: string,
  testCase: ManualCase,
): unknown {
  return {
    device_case: {
      [deviceId]: {
        case_id: testCase.case_id,
        case_name: testCase.case_name,
        case_step: testCase.case_step,
        case_function_point: testCase.case_function_point,
        test_scenario: testCase.test_scenario,
        expected_result: testCase.expected_result,
      },
    },
  }
}
