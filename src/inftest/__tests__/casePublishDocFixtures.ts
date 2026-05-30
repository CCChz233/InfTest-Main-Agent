/** Minimal valid case-publish body per interface doc L267–313. */
export function validCasePublishBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    plan_id: 'plan-demo-001',
    plan_name: '测试计划名称',
    plan_detail: {
      test_objectives: '...',
      test_scope: '...',
      test_target: '...',
      test_environment: '...',
      resources: '...',
      schedule: '...',
      deliverables: '...',
    },
    test_strategies: ['FUNCTIONAL'],
    test_env_url: 'https://test.example.com',
    plan_config_info: {},
    exec_id: 'task-demo-001',
    cases: [
      {
        case_id: 'case-demo-001',
        title: '用例名称',
        conditions: '前置条件',
        steps: [
          { step_id: '1.1.1', action: '退到桌面', expected: '成功退到桌面' },
        ],
      },
    ],
    ...overrides,
  }
}
