import { afterEach, describe, expect, test } from 'bun:test'
import { validCasePublishBody } from './casePublishDocFixtures.js'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { TaskSessionManager } from '../TaskSessionManager.js'
import { getDefaultInfTestWorkspaceRoot } from '../adapters/WorkspaceManager.js'
import { ProxyClient } from '../adapters/ProxyClient.js'
import { resetPlannerApiRealStateForTests } from '../server/plannerApiRealHandler.js'
import { clearTaskReportGenerationJobsForTests } from '../server/taskExecutionService.js'
import {
  getInfTestTaskSessionManagerForTests,
  handleInfTestTaskApiRequest,
} from '../server/taskApi.js'

const requestIds = new Set<string>()

afterEach(() => {
  TaskSessionManager.clearAll()
  clearTaskReportGenerationJobsForTests()
  resetPlannerApiRealStateForTests()
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

describe('planner API real endpoints', () => {
  test('real endpoints accept requests and write logs', async () => {
    const requests: [string, Record<string, unknown>][] = [
      [
        '/api/generate-plan',
        {
          request_id: 'test-planner-real-generate-plan',
          plan_id: 'plan-demo-001',
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
          request_id: 'test-planner-real-plan-task-publish',
          plan_id: 'plan-demo-001',
          tasks: [{ task_id: 'task-demo-001', task_type: 'FUNCTION' }],
        },
      ],
      [
        '/api/case-publish',
        {
          request_id: 'test-planner-real-case-publish',
          ...validCasePublishBody({
            plan_id: 'plan-demo-001',
            exec_id: 'task-demo-001',
            cases: [
              {
                case_id: 'case-demo-001',
                title: '登录成功',
                conditions: '',
                steps: [
                  { step_id: '1.1.1', action: '输入账号', expected: '进入首页' },
                ],
              },
            ],
          }),
        },
      ],
      [
        '/api/user-instruction',
        {
          request_id: 'test-planner-real-user-instruction',
          plan_id: 'plan-demo-001',
          user_instruction: '帮我补充登录异常场景',
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
      expect(responseBody.data.stub).toBe(false)
      expect(responseBody.data.endpoint).toBe(path)

      const log = readLog(requestId)
      expect(log.path).toBe(path)
      expect(log.parse_ok).toBe(true)
      expect(log.validation_ok).toBe(true)
      expect(log.body).toEqual(body)
    }
  })

  test('returns 400 and logs validation failures', async () => {
    const requestId = 'test-planner-real-invalid-case-publish'
    const response = await handleInfTestTaskApiRequest(
      plannerPost('/api/case-publish', {
        request_id: requestId,
        plan_id: 'plan-demo-001',
      }),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.code).toBe(400)

    const log = readLog(requestId)
    expect(log.validation_ok).toBe(false)
    expect(JSON.stringify(log.validation_issues)).toContain('cases')
  })

  test('returns 400 and logs invalid JSON with request id header', async () => {
    const requestId = 'test-planner-real-invalid-json'
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

  test('/api/task-manage START accepts async and creates a real session', async () => {
    const previousRunner = process.env.INFTEST_RUNNER
    process.env.INFTEST_RUNNER = 'fake'

    try {
      const response = await handleInfTestTaskApiRequest(
        plannerPost('/api/task-manage', {
          request_id: 'test-planner-real-task-manage-start',
          exec_id: 'exec-async-001',
          task_operation: 'START',
        }),
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        code: number
        data: {
          request_id: string
          stub: boolean
          async: boolean
          accepted: boolean
          task_status: string
        }
      }
      expect(body.code).toBe(0)
      expect(body.data.stub).toBe(false)
      expect(body.data.async).toBe(true)
      expect(body.data.accepted).toBe(true)
      expect(body.data.task_status).toBe('PENDING')

      const manager = getInfTestTaskSessionManagerForTests()
      expect(manager.get('exec-async-001')).toBeDefined()

      let session = manager.get('exec-async-001')
      for (let attempt = 0; attempt < 100; attempt += 1) {
        session = manager.get('exec-async-001')
        if (
          session?.status === 'SUCCESS' ||
          session?.status === 'FAILED'
        ) {
          break
        }
        await Bun.sleep(20)
      }
      expect(session?.status).toBe('SUCCESS')
    } finally {
      if (previousRunner === undefined) {
        delete process.env.INFTEST_RUNNER
      } else {
        process.env.INFTEST_RUNNER = previousRunner
      }
    }
  })

  test('/api/task-manage PAUSE and CONTINUE control an existing session', async () => {
    const manager = getInfTestTaskSessionManagerForTests()
    manager.start('exec-control-001', 'fake')
    manager.finish('exec-control-001', {
      status: 'SUCCESS',
      workspace: '/tmp/exec-control-001',
      artifacts: {},
      last_error: null,
      run_fake_e2e_invoked: false,
    })
    manager.start('exec-control-001', 'fake')

    const pauseResponse = await handleInfTestTaskApiRequest(
      plannerPost('/api/task-manage', {
        request_id: 'test-planner-real-task-manage-pause',
        exec_id: 'exec-control-001',
        task_operation: 'PAUSE',
      }),
    )
    expect(pauseResponse.status).toBe(200)
    const pauseBody = (await pauseResponse.json()) as {
      data: { task_status: string; stub: boolean }
    }
    expect(pauseBody.data.stub).toBe(false)
    expect(pauseBody.data.task_status).toBe('PAUSED')

    const continueResponse = await handleInfTestTaskApiRequest(
      plannerPost('/api/task-manage', {
        request_id: 'test-planner-real-task-manage-continue',
        exec_id: 'exec-control-001',
        task_operation: 'CONTINUE',
      }),
    )
    expect(continueResponse.status).toBe(200)
    const continueBody = (await continueResponse.json()) as {
      data: { task_status: string }
    }
    expect(continueBody.data.task_status).toBe('RUNNING')
  })

  test('/api/task-manage TERMINATION terminates session', async () => {
    const manager = getInfTestTaskSessionManagerForTests()
    manager.start('exec-terminate-001', 'fake')

    const response = await handleInfTestTaskApiRequest(
      plannerPost('/api/task-manage', {
        request_id: 'test-planner-real-task-manage-terminate',
        exec_id: 'exec-terminate-001',
        task_operation: 'TERMINATION',
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: { task_status: string; task_operation: string }
    }
    expect(body.data.task_status).toBe('TERMINATED')
    expect(body.data.task_operation).toBe('TERMINATION')
    expect(manager.get('exec-terminate-001')?.status).toBe('TERMINATED')
  })

  test('/api/task-report-generate returns 404 for unknown exec and supports idempotency', async () => {
    const requestBody = {
      request_id: 'test-planner-real-task-report-generate-404',
      exec_id: 'missing-exec-001',
      cases: [{ case_id: 'case-001', case_name: 'Case 1' }],
    }
    const first = await handleInfTestTaskApiRequest(
      plannerPost('/api/task-report-generate', requestBody),
    )
    expect(first.status).toBe(404)
    const firstBody = (await first.json()) as { code: number; message: string }
    expect(firstBody.code).toBe(404)
    expect(firstBody.message).toContain('missing-exec-001')

    const second = await handleInfTestTaskApiRequest(
      plannerPost('/api/task-report-generate', requestBody),
    )
    expect(second.status).toBe(404)
    const secondBody = (await second.json()) as { code: number; message: string }
    expect(secondBody.code).toBe(404)
    expect(secondBody.message).toBe(firstBody.message)
  })

  test('/api/task-report-generate restores session from disk when case_result exists', async () => {
    const execId = 'exec-report-cold-restore-001'
    const workspace = join(getDefaultInfTestWorkspaceRoot(), execId)
    mkdirSync(join(workspace, 'execution', 'results'), { recursive: true })
    writeFileSync(
      join(workspace, 'execution', 'results', 'case_result.json'),
      `${JSON.stringify({ task_id: execId, status: 'pass' }, null, 2)}\n`,
    )

    const response = await handleInfTestTaskApiRequest(
      plannerPost('/api/task-report-generate', {
        request_id: 'test-planner-report-cold-restore',
        exec_id: execId,
        cases: [
          {
            case_id: 'case-001',
            case_name: 'Case 1',
            execution_result: 'SUCCESS',
            test_steps: [{ step: 'run', expected: 'ok' }],
          },
        ],
        defects: [],
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      code: number
      data: { accepted: boolean; exec_id: string }
    }
    expect(body.code).toBe(0)
    expect(body.data.accepted).toBe(true)
    expect(body.data.exec_id).toBe(execId)
    expect(getInfTestTaskSessionManagerForTests().get(execId)?.current_stage).toBe(
      'EXECUTING',
    )
  })

  test('/api/task-report-generate accepts async and transitions to SUCCESS', async () => {
    const manager = getInfTestTaskSessionManagerForTests()
    manager.start('exec-report-ready-001', 'stateful')
    const workspace = join(process.cwd(), '.inftest-workspace', 'tmp-tests', 'exec-report-ready-001')
    mkdirSync(workspace, { recursive: true })
    manager.patch('exec-report-ready-001', {
      workspace,
      status: 'PAUSED',
      current_stage: 'EXECUTING',
    })

    const reportRequestBody = {
      request_id: 'test-report-generate-accepted',
      exec_id: 'exec-report-ready-001',
      cases: [
        {
          case_id: 'case-001',
          case_name: '登录成功',
          execution_result: 'SUCCESS',
          test_steps: [{ step: '登录', expected: '成功' }],
        },
      ],
      defects: [],
    }

    const accepted = await handleInfTestTaskApiRequest(
      plannerPost('/api/task-report-generate', reportRequestBody),
    )
    expect(accepted.status).toBe(200)
    const acceptedBody = (await accepted.json()) as {
      code: number
      data: {
        report_status: string
        task_status: string
        accepted: boolean
        async: boolean
      }
    }
    expect(acceptedBody.code).toBe(0)
    expect(acceptedBody.data.accepted).toBe(true)
    expect(acceptedBody.data.task_status).toBe('PAUSED')
    expect(['PENDING', 'RUNNING', 'SUCCESS']).toContain(acceptedBody.data.report_status)
    expect(acceptedBody.data.async).toBe(true)

    const requestPath = join(workspace, 'input', 'task_report_generate_request.json')
    expect(existsSync(requestPath)).toBe(true)

    let readyBody:
      | {
          code: number
          data: {
            report_status: string
            report_path: string | null
            report_file_key: string | null
            task_status: string
          }
        }
      | undefined
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const polled = await handleInfTestTaskApiRequest(
        plannerPost('/api/task-report-generate', {
          ...reportRequestBody,
          request_id: `test-report-generate-poll-${attempt}`,
        }),
      )
      expect(polled.status).toBe(200)
      const body = (await polled.json()) as {
        code: number
        data: {
          report_status: string
          report_path: string | null
          report_file_key: string | null
          task_status: string
        }
      }
      if (body.data.report_status === 'SUCCESS') {
        readyBody = body
        break
      }
      await Bun.sleep(50)
    }
    expect(readyBody?.code).toBe(0)
    expect(readyBody?.data.report_status).toBe('SUCCESS')
    expect(readyBody?.data.report_path).toContain('analysis/report.md')
    rmSync(workspace, { recursive: true, force: true })
  })

  test('/api/generate-plan returns contract fields for async acceptance', async () => {
    const response = await handleInfTestTaskApiRequest(
      plannerPost('/api/generate-plan', {
        request_id: 'test-generate-contract-001',
        plan_id: 'plan-contract-001',
        plan_name: 'contract',
        project_id: 'project-contract-001',
        prd_file_key: 'oss/prd.docx',
        test_env_url: 'https://example.com',
        test_strategies: ['FUNCTIONAL'],
        plan_config_info: {},
      }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      code: number
      data: {
        stub: boolean
        endpoint: string
        plan_status: string
        async: boolean
        task_count: number
      }
    }
    expect(body.code).toBe(0)
    expect(body.data.stub).toBe(false)
    expect(body.data.endpoint).toBe('/api/generate-plan')
    expect(body.data.plan_status).toBe('PENDING')
    expect(body.data.async).toBe(true)
    expect(body.data.task_count).toBe(1)
  })

  test('/api/generate-plan reports plan detail payload instead of tasks-only callback', async () => {
    const originalReportPlanDetail = ProxyClient.prototype.reportTestPlanDetail
    const originalReportGeneratedTasks = ProxyClient.prototype.reportGeneratedTasks
    let reportedPayload:
      | {
          plan_id: string
          plan_detail: Record<string, unknown>
          failure_reason: string
        }
      | null = null
    let generatedTasksCalled = false
    ProxyClient.prototype.reportTestPlanDetail = async function mockReportPlanDetail(
      input,
    ) {
      reportedPayload = input as unknown as {
        plan_id: string
        plan_detail: Record<string, unknown>
        failure_reason: string
      }
      return { accepted: true, plan_id: input.plan_id }
    }
    ProxyClient.prototype.reportGeneratedTasks = async function mockGeneratedTasks() {
      generatedTasksCalled = true
      return { accepted: true, plan_id: 'unused', task_count: 0 }
    }

    try {
      const response = await handleInfTestTaskApiRequest(
        plannerPost('/api/generate-plan', {
          request_id: 'test-generate-plan-detail-report-001',
          plan_id: 'plan-detail-report-001',
          plan_name: 'detail-report',
          project_id: 'project-detail-report-001',
          prd_file_key: 'oss/prd.docx',
          test_env_url: 'https://example.com',
          test_strategies: ['FUNCTIONAL'],
          plan_config_info: {},
        }),
      )
      expect(response.status).toBe(200)
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (reportedPayload) break
        await Bun.sleep(10)
      }
      const finalPayload = reportedPayload as
        | {
            plan_id: string
            plan_detail: Record<string, unknown>
            failure_reason: string
          }
        | null
      expect(finalPayload?.plan_id).toBe('plan-detail-report-001')
      expect(finalPayload?.failure_reason).toBe('')
      expect(typeof finalPayload?.plan_detail.test_objectives).toBe('string')
      expect(typeof finalPayload?.plan_detail.test_scope).toBe('string')
      expect(typeof finalPayload?.plan_detail.test_target).toBe('string')
      expect(typeof finalPayload?.plan_detail.test_environment).toBe('string')
      expect(typeof finalPayload?.plan_detail.resources).toBe('string')
      expect(typeof finalPayload?.plan_detail.schedule).toBe('string')
      expect(typeof finalPayload?.plan_detail.deliverables).toBe('string')
      expect(generatedTasksCalled).toBe(false)
    } finally {
      ProxyClient.prototype.reportTestPlanDetail = originalReportPlanDetail
      ProxyClient.prototype.reportGeneratedTasks = originalReportGeneratedTasks
    }
  })

  test('integration chain: generate-plan -> plan-task-publish -> case-publish(auto-start) -> /tasks', async () => {
    process.env.INFTEST_RUNNER = 'fake'
    const sequence: [string, Record<string, unknown>][] = [
      [
        '/api/generate-plan',
        {
          request_id: 'it-plan-generate',
          plan_id: 'it-plan-001',
          plan_name: 'IT plan',
          project_id: 'it-project',
          prd_file_key: 'it-prd-key',
          test_env_url: 'https://example.com',
          test_strategies: ['FUNCTIONAL'],
          plan_config_info: {},
        },
      ],
      [
        '/api/plan-task-publish',
        {
          request_id: 'it-plan-publish',
          plan_id: 'it-plan-001',
          tasks: [{ task_id: 'it-exec-001', task_type: 'FUNCTION' }],
        },
      ],
      [
        '/api/case-publish',
        {
          request_id: 'it-case-publish',
          ...validCasePublishBody({
            plan_id: 'it-plan-001',
            plan_name: 'IT plan',
            exec_id: 'it-exec-001',
            plan_config_info: { case_execution_info: { max_timeout_minutes: 5 } },
            cases: [
              {
                case_id: 'it-case-001',
                title: '登录成功',
                conditions: '用户已注册',
                steps: [
                  { step_id: '1.1.1', action: '输入账号', expected: '进入首页' },
                  { step_id: '1.1.2', action: '输入密码', expected: '登录成功' },
                ],
              },
            ],
          }),
        },
      ],
    ]

    for (const [path, body] of sequence) {
      const res = await handleInfTestTaskApiRequest(plannerPost(path, body))
      expect(res.status).toBe(200)
      const payload = (await res.json()) as { code: number }
      expect(payload.code).toBe(0)
    }

    const workspaceRoot = process.env.INFTEST_WORKSPACE_ROOT ?? join(process.cwd(), '.inftest-workspace')
    const testCasesPath = join(workspaceRoot, 'it-exec-001', 'case_generation', 'test_cases.json')
    expect(existsSync(testCasesPath)).toBe(true)
    const testCases = JSON.parse(readFileSync(testCasesPath, 'utf8')) as {
      exec_id: string
      cases: Array<{
        case_id: string
        title: string
        steps: unknown[]
      }>
    }
    expect(testCases.exec_id).toBe('it-exec-001')
    expect(Array.isArray(testCases.cases)).toBe(true)
    expect(testCases.cases.length).toBe(1)
    expect(testCases.cases[0]?.steps).toHaveLength(2)

    const planConfigPath = join(workspaceRoot, 'it-exec-001', 'input', 'plan_config.json')
    expect(existsSync(planConfigPath)).toBe(true)

    const queryResponse = await handleInfTestTaskApiRequest(
      new Request('http://127.0.0.1/tasks/it-exec-001'),
    )
    expect(queryResponse.status).toBe(200)
    const queryBody = (await queryResponse.json()) as {
      code: number
      data: { task_detail: { exec_id: string; task_status: string } }
    }
    expect(queryBody.code).toBe(0)
    expect(queryBody.data.task_detail.exec_id).toBe('it-exec-001')
    expect(['RUNNING', 'SUCCESS', 'FAILED']).toContain(
      queryBody.data.task_detail.task_status,
    )
  })

  test('case-publish cold-starts execution when test_cases already on disk', async () => {
    process.env.INFTEST_RUNNER = 'fake'
    const execId = 'it-case-publish-cold-001'
    const workspaceRoot =
      process.env.INFTEST_WORKSPACE_ROOT ?? join(process.cwd(), '.inftest-workspace')
    const workspace = join(workspaceRoot, execId)
    mkdirSync(join(workspace, 'case_generation'), { recursive: true })
    writeFileSync(
      join(workspace, 'case_generation', 'test_cases.json'),
      `${JSON.stringify(
        {
          plan_id: 'plan-cold-001',
          plan_name: 'Cold plan',
          plan_detail: {
            test_objectives: '',
            test_scope: '',
            test_target: '',
            test_environment: '',
            resources: '',
            schedule: '',
            deliverables: '',
          },
          test_strategies: ['FUNCTIONAL'],
          test_env_url: 'https://example.com',
          plan_config_info: {},
          exec_id: execId,
          cases: [
            {
              case_id: 'case-cold-001',
              title: 'Cold start case',
              conditions: '',
              steps: [{ step_id: '1', action: 'open app', expected: 'ok' }],
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const response = await handleInfTestTaskApiRequest(
      plannerPost(
        '/api/case-publish',
        validCasePublishBody({
          request_id: 'it-case-publish-cold',
          plan_id: 'plan-cold-001',
          exec_id: execId,
          cases: [
            {
              case_id: 'case-cold-001',
              title: 'Cold start case',
              conditions: '',
              steps: [{ step_id: '1', action: 'open app', expected: 'ok' }],
            },
          ],
        }),
      ),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      code: number
      data: { accepted?: boolean; auto_started?: boolean }
    }
    expect(body.code).toBe(0)
    expect(body.data.auto_started).toBe(true)

    const queryResponse = await handleInfTestTaskApiRequest(
      new Request(`http://127.0.0.1/tasks/${execId}`),
    )
    expect(queryResponse.status).toBe(200)
  })

  test('case-publish requires exec_id when plan has multiple tasks', async () => {
    const requestId = 'test-planner-multi-task-case-publish'
    await handleInfTestTaskApiRequest(
      plannerPost('/api/plan-task-publish', {
        request_id: 'test-planner-multi-task-publish',
        plan_id: 'plan-multi-001',
        tasks: [
          { task_id: 'task-multi-001', task_type: 'FUNCTION' },
          { task_id: 'task-multi-002', task_type: 'FUNCTION' },
        ],
      }),
    )

    const response = await handleInfTestTaskApiRequest(
      plannerPost(
        '/api/case-publish',
        validCasePublishBody({
          request_id: requestId,
          plan_id: 'plan-multi-001',
          exec_id: undefined,
          cases: [
            {
              case_id: 'case-1',
              title: 'Case 1',
              conditions: '',
              steps: [{ step_id: '1', action: 'step', expected: 'ok' }],
            },
          ],
        }),
      ),
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.code).toBe(400)
    expect(String(body.message)).toContain('exec_id')
  })
})
