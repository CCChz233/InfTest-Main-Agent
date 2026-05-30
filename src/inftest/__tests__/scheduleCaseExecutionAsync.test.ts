import { afterEach, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { getDefaultInfTestWorkspaceRoot } from '../adapters/WorkspaceManager.js'
import { TaskSessionManager } from '../TaskSessionManager.js'
import type { TaskSession } from '../schemas/session.js'
import {
  bootstrapCaseExecutionSessionFromDisk,
  bootstrapReportGenerationSessionFromDisk,
  ensureReportGenerationSession,
  hasExecutionCaseResultOnDisk,
  hasPublishedTestCasesOnDisk,
  inferCaseExecutionTaskOperation,
  scheduleCaseExecutionAsync,
  scheduleTaskReportGenerateAsync,
  waitUntilExecutionPaused,
  waitUntilPaused,
} from '../server/taskExecutionService.js'

afterEach(() => {
  TaskSessionManager.clearAll()
  delete process.env.INFTEST_CASE_PUBLISH_WAIT_MS
})

function createSession(taskId: string, update: Partial<TaskSession>): void {
  const manager = new TaskSessionManager()
  manager.start(taskId, 'stateful')
  manager.patch(taskId, update)
}

test('inferCaseExecutionTaskOperation distinguishes start and restart', () => {
  expect(
    inferCaseExecutionTaskOperation({
      task_id: 't1',
      runner: 'stateful',
      status: 'PAUSED',
      current_stage: 'DATA_GEN',
      previous_stage: null,
      active_skill: null,
      blocking_reason: null,
      stage_history: [],
      workspace: '/tmp/t1',
      started_at: new Date().toISOString(),
      finished_at: null,
      last_error: null,
      run_fake_e2e_invoked: false,
      artifacts: {},
    }),
  ).toBe('START')

  expect(
    inferCaseExecutionTaskOperation({
      task_id: 't1',
      runner: 'stateful',
      status: 'SUCCESS',
      current_stage: 'COMPLETED',
      previous_stage: null,
      active_skill: null,
      blocking_reason: null,
      stage_history: [],
      workspace: '/tmp/t1',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      last_error: null,
      run_fake_e2e_invoked: false,
      artifacts: {},
    }),
  ).toBe('RESTART')

  expect(
    inferCaseExecutionTaskOperation({
      task_id: 't1',
      runner: 'stateful',
      status: 'RUNNING',
      current_stage: 'EXECUTING',
      previous_stage: null,
      active_skill: null,
      blocking_reason: null,
      stage_history: [],
      workspace: '/tmp/t1',
      started_at: new Date().toISOString(),
      finished_at: null,
      last_error: null,
      run_fake_e2e_invoked: false,
      artifacts: {},
    }),
  ).toBe('RESTART')
})

test('waitUntilPaused resolves when session becomes PAUSED', async () => {
  const taskId = 'wait-paused-task'
  createSession(taskId, { status: 'RUNNING', current_stage: 'DATA_GEN' })

  setTimeout(() => {
    new TaskSessionManager().patch(taskId, {
      status: 'PAUSED',
      current_stage: 'DATA_GEN',
    })
  }, 100)

  const result = await waitUntilPaused(taskId, 2_000)
  expect(result).toBe('PAUSED')
})

test('waitUntilPaused times out when generation never pauses', async () => {
  const taskId = 'wait-timeout-task'
  createSession(taskId, { status: 'RUNNING', current_stage: 'DATA_GEN' })

  const result = await waitUntilPaused(taskId, 300)
  expect(result).toBe('TIMEOUT')
})

test('scheduleCaseExecutionAsync rejects when no session and no test_cases on disk', () => {
  const result = scheduleCaseExecutionAsync('missing-session-task')
  expect(result.httpStatus).toBe(409)
  expect(result.code).toBe(409)
  expect(result.data.accepted).toBe(false)
  expect(result.message).toContain('test_cases.json')
})

test('bootstrapCaseExecutionSessionFromDisk creates PAUSED session when cases exist', async () => {
  const taskId = 'cold-bootstrap-task'
  const workspace = join(getDefaultInfTestWorkspaceRoot(), taskId)
  await mkdir(join(workspace, 'case_generation'), { recursive: true })
  await writeFile(
    join(workspace, 'case_generation', 'test_cases.json'),
    `${JSON.stringify(
      {
        source: 'case_publish',
        root: {
          children: [
            {
              node_id: 'case-1',
              title: 'Case 1',
              steps: [{ action: 'step-a', expected: 'ok-a' }],
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  expect(hasPublishedTestCasesOnDisk(taskId)).toBe(true)
  const session = bootstrapCaseExecutionSessionFromDisk(taskId)
  expect(session?.status).toBe('PAUSED')
  expect(session?.current_stage).toBe('DATA_GEN')

  const result = scheduleCaseExecutionAsync(taskId)
  expect(result.httpStatus).toBe(200)
  expect(result.data.accepted).toBe(true)
  expect(result.data.task_operation).toBe('START')
})

test('bootstrapReportGenerationSessionFromDisk creates PAUSED@EXECUTING when case_result exists', async () => {
  const taskId = 'cold-report-bootstrap-task'
  const workspace = join(getDefaultInfTestWorkspaceRoot(), taskId)
  await mkdir(join(workspace, 'execution', 'results'), { recursive: true })
  await writeFile(
    join(workspace, 'execution', 'results', 'case_result.json'),
    `${JSON.stringify({ task_id: taskId, status: 'pass' }, null, 2)}\n`,
    'utf8',
  )

  expect(hasExecutionCaseResultOnDisk(taskId)).toBe(true)
  const session = bootstrapReportGenerationSessionFromDisk(taskId)
  expect(session?.status).toBe('PAUSED')
  expect(session?.current_stage).toBe('EXECUTING')
  expect(session?.artifacts.report_agent_log).toContain('case_result.json')

  const scheduled = scheduleTaskReportGenerateAsync(taskId)
  expect(scheduled.httpStatus).toBe(200)
  expect(scheduled.data?.accepted).toBe(true)
})

test('ensureReportGenerationSession restores session after clearAll', async () => {
  const taskId = 'ensure-report-session-task'
  const workspace = join(getDefaultInfTestWorkspaceRoot(), taskId)
  await mkdir(join(workspace, 'execution', 'results'), { recursive: true })
  await writeFile(
    join(workspace, 'execution', 'results', 'case_result.json'),
    `${JSON.stringify({ task_id: taskId, status: 'pass' }, null, 2)}\n`,
    'utf8',
  )

  bootstrapReportGenerationSessionFromDisk(taskId)
  TaskSessionManager.clearAll()

  const restored = ensureReportGenerationSession(taskId)
  expect(restored?.status).toBe('PAUSED')
  expect(restored?.current_stage).toBe('EXECUTING')
})

test('waitUntilExecutionPaused resolves when session is PAUSED at EXECUTING', async () => {
  const taskId = 'wait-execution-paused-task'
  createSession(taskId, { status: 'PAUSED', current_stage: 'EXECUTING' })

  const result = await waitUntilExecutionPaused(taskId, 2_000)
  expect(result).toBe('EXECUTION_PAUSED')
})

test('scheduleCaseExecutionAsync accepts PAUSED session with START operation', () => {
  const taskId = 'paused-exec-task'
  createSession(taskId, { status: 'PAUSED', current_stage: 'DATA_GEN' })

  const result = scheduleCaseExecutionAsync(taskId)
  expect(result.httpStatus).toBe(200)
  expect(result.code).toBe(0)
  expect(result.data.accepted).toBe(true)
  expect(result.data.task_operation).toBe('START')
  expect(result.data.task_status).toBe('PAUSED')
})

test('scheduleCaseExecutionAsync marks RESTART for completed session', () => {
  const taskId = 'restart-exec-task'
  createSession(taskId, {
    status: 'SUCCESS',
    current_stage: 'COMPLETED',
    finished_at: new Date().toISOString(),
  })

  const result = scheduleCaseExecutionAsync(taskId)
  expect(result.httpStatus).toBe(200)
  expect(result.data.task_operation).toBe('RESTART')
})
