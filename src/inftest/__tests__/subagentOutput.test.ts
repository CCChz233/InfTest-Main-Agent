import { describe, expect, test } from 'bun:test'
import { parseSubAgentOutputJson, SubAgentOutputJsonSchema } from '../schemas/subagentOutput.js'

describe('parseSubAgentOutputJson', () => {
  test('parses valid payload', () => {
    const raw = JSON.stringify({
      success: true,
      agent_name: 'test_generation',
      status: 'SUCCESS',
      task_id: 't1',
      artifacts: { plan: '/p' },
      metrics: { duration_ms: 10 },
      error: null,
    })
    const parsed = parseSubAgentOutputJson(raw)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.agent_name).toBe('test_generation')
    }
  })

  test('rejects invalid JSON', () => {
    const parsed = parseSubAgentOutputJson('not-json')
    expect(parsed.ok).toBe(false)
  })

  test('parses real adapter output with case_count in metrics', () => {
    const raw = JSON.stringify({
      success: true,
      agent_name: 'test_generation',
      status: 'SUCCESS',
      task_id: 'plan-agent-test-task-004',
      artifacts: {
        test_cases:
          '/data/inftest-workspace/plan-agent-test-task-004/case_generation/cli_test_cases.json',
      },
      metrics: {
        duration_ms: 250770,
        case_count: 24,
      },
      error: null,
    })
    const parsed = parseSubAgentOutputJson(raw)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.metrics?.case_count).toBe(24)
    }
  })
})

describe('SubAgentOutputJsonSchema', () => {
  test('allows optional metrics and error', () => {
    const result = SubAgentOutputJsonSchema.safeParse({
      success: true,
      agent_name: 'device_scheduler',
      status: 'SUCCESS',
      task_id: 't1',
      artifacts: {},
    })
    expect(result.success).toBe(true)
  })
})
