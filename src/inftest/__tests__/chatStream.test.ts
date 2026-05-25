import { afterEach, describe, expect, test } from 'bun:test'
import { TaskSessionManager } from '../TaskSessionManager.js'
import { handleChatStream } from '../server/chatStream.js'

afterEach(() => {
  TaskSessionManager.clearAll()
})

const chatRequest = (body: Record<string, unknown>) =>
  new Request('http://127.0.0.1/tasks/chat/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('handleChatStream', () => {
  test('returns 404 envelope when task session is missing', async () => {
    const manager = new TaskSessionManager()
    const response = await handleChatStream(
      chatRequest({
        user_id: 'user-demo',
        task_id: 'missing-task',
        user_instruction: '总结一下当前任务状态',
      }),
      manager,
      { isAuthEnabled: () => true },
    )
    expect(response.status).toBe(404)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.code).toBe(404)
  })

  test('returns 400 when user_id is missing', async () => {
    const manager = new TaskSessionManager()
    const response = await handleChatStream(
      chatRequest({ task_id: 'task-demo-001' }),
      manager,
      { isAuthEnabled: () => true },
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.code).toBe(400)
  })

  test('streams ChatStreamResponse-shaped SSE envelopes', async () => {
    const manager = new TaskSessionManager()
    manager.start('task-demo-001', 'fake')
    manager.finish('task-demo-001', {
      status: 'SUCCESS',
      workspace: '/tmp/task-demo-001',
      artifacts: { plan: '/tmp/task-demo-001/plan.json' },
      last_error: null,
      run_fake_e2e_invoked: false,
    })

    const response = await handleChatStream(
      chatRequest({
        user_id: 'user-demo',
        task_id: 'task-demo-001',
        user_instruction: '总结一下当前任务状态',
      }),
      manager,
      {
        isAuthEnabled: () => true,
        async *streamChunks() {
          yield {
            task_id: 'task-demo-001',
            chunk: '任务状态：SUCCESS',
            finished: false,
            message_id: 'msg-test',
          }
          yield {
            task_id: 'task-demo-001',
            chunk: '',
            finished: true,
            message_id: 'msg-test',
          }
        },
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const text = await response.text()
    expect(text).toContain('"code":0')
    expect(text).toContain('"data":{"task_id":"task-demo-001"')
    expect(text).toContain('"chunk":"任务状态：SUCCESS"')
    expect(text).toContain('"finished":true')
    expect(text).toContain('"message_id":"msg-test"')
  })
})
