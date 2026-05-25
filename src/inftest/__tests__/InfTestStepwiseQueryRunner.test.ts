import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
import { InfTestStepwiseQueryRunner } from '../InfTestStepwiseQueryRunner.js'
import { InfTestTools } from '../tools/index.js'

async function* fakeEngine(): AsyncGenerator<SDKMessage, void, unknown> {
  yield {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', name: 'invoke_subagent', id: 'tu_1' },
      ],
    },
  } as SDKMessage
  yield {
    type: 'result',
    subtype: 'success',
    errors: [],
  } as SDKMessage
}

describe('InfTestStepwiseQueryRunner', () => {
  test('marks invoke_subagent_invoked and uses orchestration stepwise', async () => {
    const runner = new InfTestStepwiseQueryRunner({
      queryEngine: { submitMessage: () => fakeEngine() },
      tools: InfTestTools,
    })
    const result = await runner.runTask('task-unit-001')
    expect(result.orchestration).toBe('stepwise')
    expect(result.invoke_subagent_invoked).toBe(true)
    expect(result.run_fake_e2e_invoked).toBe(false)
  })
})
