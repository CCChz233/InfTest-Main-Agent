import { afterEach, expect, test } from 'bun:test'
import {
  applyStatefulRunnerResult,
  TaskSessionManager,
} from '../TaskSessionManager.js'
import type { InfTestStatefulRunnerResult } from '../StatefulRunner.js'

afterEach(() => {
  TaskSessionManager.clearAll()
})

function baseRunnerResult(
  overrides: Partial<InfTestStatefulRunnerResult> = {},
): InfTestStatefulRunnerResult {
  return {
    task_id: 'task-partial-001',
    status: 'SUCCESS',
    workspace: '/tmp/task-partial-001',
    artifacts: { test_cases: '/tmp/task-partial-001/case_generation/test_cases.json' },
    reported_cases: [],
    summary_found: false,
    steps: [],
    error: null,
    ...overrides,
  }
}

test('applyStatefulRunnerResult preserves PAUSED session on partial stop', () => {
  const manager = new TaskSessionManager()
  const taskId = 'task-partial-001'
  manager.start(taskId, 'stateful')
  manager.patch(taskId, {
    status: 'PAUSED',
    current_stage: 'EXECUTING',
    workspace: '/tmp/task-partial-001',
  })

  const session = applyStatefulRunnerResult(
    manager,
    taskId,
    baseRunnerResult({ stopped_after_stage: 'EXECUTING' }),
  )

  expect(session.status).toBe('PAUSED')
  expect(session.current_stage).toBe('EXECUTING')
  expect(session.finished_at).toBeNull()
  expect(session.artifacts.test_cases).toContain('test_cases.json')
})

test('applyStatefulRunnerResult finishes session when runner completed fully', () => {
  const manager = new TaskSessionManager()
  const taskId = 'task-full-001'
  manager.start(taskId, 'stateful')
  manager.patch(taskId, { status: 'RUNNING', current_stage: 'REFLECTING' })

  const session = applyStatefulRunnerResult(
    manager,
    taskId,
    baseRunnerResult({
      task_id: taskId,
      status: 'SUCCESS',
      stopped_after_stage: undefined,
    }),
  )

  expect(session.status).toBe('SUCCESS')
  expect(session.finished_at).not.toBeNull()
})
