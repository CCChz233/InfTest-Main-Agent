import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { TaskSessionManager } from '../TaskSessionManager.js'
import {
  getInfTestTaskSessionManagerForTests,
  handleInfTestTaskApiRequest,
} from '../server/taskApi.js'

const requestIds = new Set<string>()

afterEach(() => {
  TaskSessionManager.clearAll()
  for (const requestId of requestIds) {
    rmSync(logPath(requestId), { force: true })
  }
  requestIds.clear()
})

function logPath(requestId: string): string {
  return join(
    process.cwd(),
    '.inftest-workspace',
    'planner-api-stub',
    `${requestId}.json`,
  )
}

function readLog(requestId: string): Record<string, unknown> {
  return JSON.parse(readFileSync(logPath(requestId), 'utf8')) as Record<
    string,
    unknown
  >
}

function plannerPost(path: string, body: Record<string, unknown>): Request {
  if (typeof body.request_id === 'string') {
    requestIds.add(body.request_id)
  }
  return new Request(`http://127.0.0.1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('planner API stub', () => {
  test('accepts stub endpoints, writes request logs, and does not start tasks', async () => {
    const requests: [string, Record<string, unknown>][] = [
      [
        '/api/generate-plan',
        {
          request_id: 'test-planner-stub-generate-plan',
          plan_name: '登录流程测试计划',
          project_id: 'xh',
          prd_file_key: 'oss/prd.docx',
          test_env_url: 'https://test.example.com',
          test_strategies: ['FUNCTIONAL'],
          plan_config_info: {},
        },
      ],
      [
        '/api/plan-task-publish',
        {
          request_id: 'test-planner-stub-plan-task-publish',
          plan_id: 'plan-demo-001',
          tasks: [{ task_id: 'task-demo-001', task_type: 'FUNCTION' }],
        },
      ],
      [
        '/api/case-publish',
        {
          request_id: 'test-planner-stub-case-publish',
          plan_id: 'plan-demo-001',
          exec_id: 'exec-demo-001',
          cases: [{ case_id: 'case-demo-001', case_name: '登录成功' }],
        },
      ],
      [
        '/api/task-report-generate',
        {
          request_id: 'test-planner-stub-task-report-generate',
          exec_id: 'exec-demo-001',
        },
      ],
      [
        '/api/task-manage',
        {
          request_id: 'test-planner-stub-task-manage',
          exec_id: 'exec-demo-001',
          task_operation: 'START',
        },
      ],
      [
        '/api/user-instruction',
        {
          request_id: 'test-planner-stub-user-instruction',
          plan_id: 'plan-demo-001',
          user_instruction: '帮我补充登录异常场景',
        },
      ],
      [
        '/api/payload',
        {
          request_id: 'test-planner-stub-payload',
          plan_id: 'plan-demo-001',
          user_instruction: '帮我解释当前计划状态',
        },
      ],
    ]

    for (const [path, body] of requests) {
      const requestId = body.request_id as string
      const response = await handleInfTestTaskApiRequest(
        plannerPost(path, body),
      )
      expect(response.status).toBe(200)
      const responseBody = (await response.json()) as {
        code: number
        data: { request_id: string; endpoint: string; stub: boolean }
      }
      expect(responseBody.code).toBe(0)
      expect(responseBody.data.request_id).toBe(requestId)
      expect(responseBody.data.stub).toBe(true)

      const log = readLog(requestId)
      expect(log.path).toBe(path)
      expect(log.parse_ok).toBe(true)
      expect(log.validation_ok).toBe(true)
      expect(log.body).toEqual(body)
    }

    const manager = getInfTestTaskSessionManagerForTests()
    expect(manager.get('exec-demo-001')).toBeUndefined()
  })

  test('returns 400 and logs validation failures', async () => {
    const requestId = 'test-planner-stub-invalid-case-publish'
    const response = await handleInfTestTaskApiRequest(
      plannerPost('/api/case-publish', {
        request_id: requestId,
        plan_id: 'plan-demo-001',
      }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.code).toBe(400)
    expect(body.message).toContain('case-publish requires')

    const log = readLog(requestId)
    expect(log.validation_ok).toBe(false)
    expect(JSON.stringify(log.validation_issues)).toContain('case-publish')
  })

  test('returns 400 and logs invalid JSON with request id header', async () => {
    const requestId = 'test-planner-stub-invalid-json'
    requestIds.add(requestId)
    const response = await handleInfTestTaskApiRequest(
      new Request('http://127.0.0.1/api/task-manage', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': requestId,
        },
        body: '{',
      }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.code).toBe(400)
    expect(existsSync(logPath(requestId))).toBe(true)
    const log = readLog(requestId)
    expect(log.parse_ok).toBe(false)
    expect(log.raw_body).toBe('{')
  })
})
