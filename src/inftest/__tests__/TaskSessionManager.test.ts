import { afterEach, describe, expect, test } from 'bun:test'
import type { InfTestFakeE2EResult } from '../FakeE2ERunner.js'
import type { InfTestQueryRunnerResult } from '../InfTestQueryRunner.js'
import {
  finishSessionFromFakeResult,
  finishSessionFromQueryResult,
  TaskSessionManager,
  TaskSessionNotFoundError,
  toTaskResponse,
  toTaskSessionView,
} from '../TaskSessionManager.js'

afterEach(() => {
  TaskSessionManager.clearAll()
})

describe('TaskSessionManager', () => {
  test('starts and finishes a fake session', () => {
    const manager = new TaskSessionManager()
    const started = manager.start('task-demo-001', 'fake')
    expect(started.status).toBe('RUNNING')
    expect(started.runner).toBe('fake')

    const fakeResult: InfTestFakeE2EResult = {
      task_id: 'task-demo-001',
      status: 'SUCCESS',
      workspace: '/tmp/task-demo-001',
      plan_path: '/tmp/task-demo-001/plan.json',
      artifacts: { plan: '/tmp/task-demo-001/plan.json' },
      reported_cases: [],
      summary_found: true,
      steps: [],
      error: null,
    }

    const finished = finishSessionFromFakeResult(manager, 'task-demo-001', fakeResult)
    expect(finished.status).toBe('SUCCESS')
    expect(finished.run_fake_e2e_invoked).toBe(false)
    expect(finished.finished_at).not.toBeNull()

    const response = toTaskResponse(finished)
    expect(response.task_id).toBe('task-demo-001')
    expect(response.runner).toBe('fake')
    expect(response.status).toBe('SUCCESS')
    expect(response.workspace).toBe('/tmp/task-demo-001')
    expect(response.artifacts.plan).toBe('/tmp/task-demo-001/plan.json')
    expect(response.message.length).toBeGreaterThan(0)
  })

  test('finishes a query session with run_fake_e2e_invoked', () => {
    const manager = new TaskSessionManager()
    manager.start('task-demo-001', 'query')

    const queryResult: InfTestQueryRunnerResult = {
      task_id: 'task-demo-001',
      status: 'SUCCESS',
      run_fake_e2e_invoked: true,
      final_model_reply: 'SUCCESS: all steps passed',
      tool_result: {
        task_id: 'task-demo-001',
        status: 'SUCCESS',
        workspace: '/tmp/task-demo-001',
        plan_path: null,
        artifacts: { plan: '/tmp/task-demo-001/plan.json' },
        reported_cases: [],
        summary_found: true,
        steps: [],
        error: null,
      },
      result_subtype: 'success',
      errors: [],
    }

    const finished = finishSessionFromQueryResult(
      manager,
      'task-demo-001',
      queryResult,
    )
    expect(finished.run_fake_e2e_invoked).toBe(true)
    expect(toTaskResponse(finished).status).toBe('SUCCESS')
  })

  test('applyControl PAUSE and CONTINUE update session status', () => {
    const manager = new TaskSessionManager()
    manager.start('task-demo-001', 'fake')
    manager.finish('task-demo-001', {
      status: 'SUCCESS',
      workspace: '/tmp/task-demo-001',
      artifacts: { plan: '/tmp/plan.json' },
    })

    const paused = manager.applyControl('task-demo-001', 'PAUSE')
    expect(paused.session.status).toBe('PAUSED')
    expect(toTaskSessionView(paused.session).message).toContain('paused')

    const continued = manager.applyControl('task-demo-001', 'CONTINUE')
    expect(continued.session.status).toBe('RUNNING')
    expect(toTaskSessionView(continued.session).message).toContain('running')
  })

  test('applyControl TERMINATE sets TERMINATED and finished_at', () => {
    const manager = new TaskSessionManager()
    manager.start('task-demo-001', 'fake')
    manager.finish('task-demo-001', {
      status: 'SUCCESS',
      workspace: '/tmp/task-demo-001',
      artifacts: {},
    })

    const terminated = manager.applyControl('task-demo-001', 'TERMINATE')
    expect(terminated.session.status).toBe('TERMINATED')
    expect(terminated.session.finished_at).not.toBeNull()
    expect(terminated.terminated_subagents).toEqual([])
  })

  test('require throws TaskSessionNotFoundError for missing task', () => {
    const manager = new TaskSessionManager()
    expect(() => manager.require('missing')).toThrow(TaskSessionNotFoundError)
    expect(() => manager.applyControl('missing', 'PAUSE')).toThrow(
      TaskSessionNotFoundError,
    )
  })
})
