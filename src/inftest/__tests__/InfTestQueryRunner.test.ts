import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
import type { InfTestFakeE2EResult } from '../FakeE2ERunner.js'
import {
  InfTestQueryRunner,
  internalInfTestQueryRunnerTestUtils,
} from '../InfTestQueryRunner.js'
import { InfTestQueryTools } from '../tools/index.js'

const fakeToolResult: InfTestFakeE2EResult = {
  task_id: 'task-demo-001',
  status: 'SUCCESS',
  workspace: '/tmp/task-demo-001',
  plan_path: '/tmp/task-demo-001/plan.json',
  artifacts: {
    plan: '/tmp/task-demo-001/plan.json',
  },
  reported_cases: ['case_login_success.json'],
  summary_found: true,
  steps: [
    {
      name: 'run_fake_e2e',
      status: 'SUCCESS',
      duration_ms: 1,
    },
  ],
  error: null,
}

describe('InfTestQueryRunner', () => {
  test('exposes run_fake_e2e as the query-runner tool', () => {
    expect(InfTestQueryTools.map(tool => tool.name)).toEqual(['run_fake_e2e'])
  })

  test('collects SUCCESS from run_fake_e2e tool result', async () => {
    const seenPrompts: string[] = []
    async function* submitMessage(prompt: string) {
      seenPrompts.push(prompt)
      yield {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_test',
              name: 'run_fake_e2e',
              input: { task_id: 'task-demo-001' },
            },
          ],
        },
      } satisfies SDKMessage
      yield {
        type: 'user',
        tool_use_result: fakeToolResult,
      } satisfies SDKMessage
      yield {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'text',
              text: 'SUCCESS: fake E2E completed',
            },
          ],
        },
      } satisfies SDKMessage
      yield {
        type: 'result',
        subtype: 'success',
        result: 'SUCCESS: fake E2E completed',
      } satisfies SDKMessage
    }

    const runner = new InfTestQueryRunner({
      queryEngine: { submitMessage },
    })
    const result = await runner.runTask('task-demo-001')

    expect(seenPrompts[0]).toContain('task-demo-001')
    expect(result.run_fake_e2e_invoked).toBe(true)
    expect(result.status).toBe('SUCCESS')
    expect(result.tool_result?.status).toBe('SUCCESS')
    expect(result.final_model_reply).toContain('SUCCESS')
  })

  test('parses wrapped string tool results', () => {
    const parsed =
      internalInfTestQueryRunnerTestUtils.parseToolResult({
        content: JSON.stringify(fakeToolResult),
      })

    expect(parsed?.status).toBe('SUCCESS')
  })

  test('parses tool results from user message content blocks', () => {
    const parsed =
      internalInfTestQueryRunnerTestUtils.parseToolResultFromUserMessage({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_test',
              content: JSON.stringify(fakeToolResult),
            },
          ],
        },
      } satisfies SDKMessage)

    expect(parsed?.status).toBe('SUCCESS')
  })

  test('fails when run_fake_e2e was not invoked', async () => {
    async function* submitMessage(_prompt: string) {
      yield {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'done without tools' }],
        },
      } satisfies SDKMessage
      yield {
        type: 'result',
        subtype: 'success',
        result: 'done',
      } satisfies SDKMessage
    }

    const result = await new InfTestQueryRunner({
      queryEngine: { submitMessage },
    }).runTask('task-demo-001')

    expect(result.status).toBe('FAILED')
    expect(result.run_fake_e2e_invoked).toBe(false)
    expect(result.errors).toContain('run_fake_e2e was not invoked')
  })
})
