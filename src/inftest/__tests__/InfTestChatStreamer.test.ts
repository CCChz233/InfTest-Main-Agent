import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
import {
  internalInfTestChatStreamerTestUtils,
  streamInfTestChatChunks,
} from '../InfTestChatStreamer.js'
import type { TaskSession } from '../schemas/session.js'

const session: TaskSession = {
  task_id: 'task-demo-001',
  runner: 'fake',
  status: 'SUCCESS',
  current_stage: 'COMPLETED',
  previous_stage: 'REFLECTING',
  active_skill: null,
  blocking_reason: null,
  stage_history: [],
  workspace: '/tmp/task-demo-001',
  started_at: '2026-01-01T00:00:00.000Z',
  finished_at: '2026-01-01T00:01:00.000Z',
  last_error: null,
  run_fake_e2e_invoked: false,
  artifacts: {
    plan: '/tmp/task-demo-001/plan.json',
    test_cases: '/tmp/task-demo-001/case_generation/test_cases.json',
  },
}

describe('streamInfTestChatChunks', () => {
  test('yields text deltas and finished chunk', async () => {
    async function* submitMessage(_prompt: string) {
      yield {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: '任务' },
        },
      } satisfies SDKMessage
      yield {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: '已完成' },
        },
      } satisfies SDKMessage
      yield {
        type: 'result',
        subtype: 'success',
        result: '任务已完成',
      } satisfies SDKMessage
    }

    const chunks = []
    for await (const chunk of streamInfTestChatChunks({
      session,
      userInstruction: '总结一下当前任务状态',
      messageId: 'msg-test-001',
      queryEngine: { submitMessage },
    })) {
      chunks.push(chunk)
    }

    expect(chunks.map(c => c.chunk).join('')).toBe('任务已完成')
    expect(chunks.at(-1)?.finished).toBe(true)
    expect(chunks.every(c => c.message_id === 'msg-test-001')).toBe(true)

    expect(chunks.every(c => c.task_id === session.task_id)).toBe(true)
  })

  test('extracts text_delta from stream_event', () => {
    const text =
      internalInfTestChatStreamerTestUtils.extractTextDeltaFromStreamEvent({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'hello' },
        },
      } as SDKMessage)
    expect(text).toBe('hello')
  })
})
