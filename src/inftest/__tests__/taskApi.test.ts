import { afterEach, describe, expect, test } from 'bun:test'
import { TaskSessionManager } from '../TaskSessionManager.js'
import {
  getInfTestTaskSessionManagerForTests,
  handleInfTestTaskApiRequest,
} from '../server/taskApi.js'

afterEach(() => {
  TaskSessionManager.clearAll()
})

function postAlter(body: Record<string, unknown>): Request {
  return new Request('http://127.0.0.1/tasks/alter', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function postTerminate(body: Record<string, unknown>): Request {
  return new Request('http://127.0.0.1/tasks/terminate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('handleInfTestTaskApiRequest', () => {
  test('GET /tasks/:task_id returns 404 envelope when missing', async () => {
    const response = await handleInfTestTaskApiRequest(
      new Request('http://127.0.0.1/tasks/unknown-task'),
    )
    expect(response.status).toBe(404)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.code).toBe(404)
    expect(body.message).toContain('unknown-task')
  })

  test('GET /tasks/:task_id returns task_detail in data', async () => {
    const manager = getInfTestTaskSessionManagerForTests()
    manager.start('task-demo-001', 'fake')
    manager.finish('task-demo-001', {
      status: 'SUCCESS',
      workspace: '/tmp/task-demo-001',
      artifacts: { plan: '/tmp/task-demo-001/plan.json' },
      last_error: null,
      run_fake_e2e_invoked: false,
    })

    const response = await handleInfTestTaskApiRequest(
      new Request('http://127.0.0.1/tasks/task-demo-001'),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      code: number
      message: string
      data: { task_detail: Record<string, unknown> }
    }
    expect(body.code).toBe(0)
    expect(body.data.task_detail.task_id).toBe('task-demo-001')
    expect(body.data.task_detail.runner).toBe('fake')
    expect(body.data.task_detail.task_status).toBe('SUCCESS')
    expect(body.data.task_detail.workspace).toBe('/tmp/task-demo-001')
    expect(body.data.task_detail.message).toBeTypeOf('string')
  })

  test('POST /tasks/alter PAUSE/CONTINUE and POST /tasks/terminate', async () => {
    const manager = getInfTestTaskSessionManagerForTests()
    manager.start('task-demo-001', 'fake')

    const pauseResponse = await handleInfTestTaskApiRequest(
      postAlter({ task_id: 'task-demo-001', task_operation: 'PAUSE' }),
    )
    expect(pauseResponse.status).toBe(200)
    const pauseBody = (await pauseResponse.json()) as Record<string, unknown>
    expect(pauseBody.code).toBe(0)
    expect(pauseBody.message).toBe('Task paused')

    const getAfterPause = await handleInfTestTaskApiRequest(
      new Request('http://127.0.0.1/tasks/task-demo-001'),
    )
    const getBody = (await getAfterPause.json()) as {
      data: { task_detail: { task_status: string } }
    }
    expect(getBody.data.task_detail.task_status).toBe('PAUSED')

    const continueResponse = await handleInfTestTaskApiRequest(
      postAlter({ task_id: 'task-demo-001', task_operation: 'CONTINUE' }),
    )
    expect(continueResponse.status).toBe(200)
    const continueBody = (await continueResponse.json()) as Record<
      string,
      unknown
    >
    expect(continueBody.message).toBe('Task continued')

    const terminateResponse = await handleInfTestTaskApiRequest(
      postTerminate({ task_id: 'task-demo-001' }),
    )
    expect(terminateResponse.status).toBe(200)
    const terminateBody = (await terminateResponse.json()) as Record<
      string,
      unknown
    >
    expect(terminateBody.code).toBe(0)
    expect(terminateBody.message).toBe('Task terminated')

    const getAfterTerminate = await handleInfTestTaskApiRequest(
      new Request('http://127.0.0.1/tasks/task-demo-001'),
    )
    const terminated = (await getAfterTerminate.json()) as {
      data: { task_detail: { task_status: string; finished_at: string | null } }
    }
    expect(terminated.data.task_detail.task_status).toBe('TERMINATED')
    expect(terminated.data.task_detail.finished_at).not.toBeNull()
  })

  test('POST /tasks/alter PAUSE returns 404 when session missing', async () => {
    const response = await handleInfTestTaskApiRequest(
      postAlter({ task_id: 'missing-task', task_operation: 'PAUSE' }),
    )
    expect(response.status).toBe(404)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.code).toBe(404)
  })

  test('legacy /task and /chat/stream paths return 404', async () => {
    const legacyTask = await handleInfTestTaskApiRequest(
      new Request('http://127.0.0.1/task', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          task_id: 'task-demo-001',
          task_operation: 'START',
        }),
      }),
    )
    expect(legacyTask.status).toBe(404)

    const legacyChat = await handleInfTestTaskApiRequest(
      new Request('http://127.0.0.1/chat/stream', { method: 'POST' }),
    )
    expect(legacyChat.status).toBe(404)
  })

  test('POST /tasks/chat/stream returns 404 without session', async () => {
    const response = await handleInfTestTaskApiRequest(
      new Request('http://127.0.0.1/tasks/chat/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          user_id: 'user-demo',
          task_id: 'missing-task',
          user_instruction: '总结一下当前任务状态',
        }),
      }),
    )
    expect(response.status).toBe(404)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.code).toBe(404)
  })
})
