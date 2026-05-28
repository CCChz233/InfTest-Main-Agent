import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
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
    expect(started.current_stage).toBeNull()
    expect(started.active_skill).toBeNull()
    expect(started.stage_history).toEqual([])

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

    const finished = finishSessionFromFakeResult(
      manager,
      'task-demo-001',
      fakeResult,
    )
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

  test('finishes a stepwise query session with discovered workspace artifacts', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'inftest-session-'))
    try {
      mkdirSync(join(workspace, 'case_generation'), { recursive: true })
      mkdirSync(join(workspace, 'device_scheduling'), { recursive: true })
      mkdirSync(join(workspace, 'execution', 'results'), { recursive: true })
      mkdirSync(join(workspace, 'analysis'), { recursive: true })
      writeFileSync(join(workspace, 'plan.json'), '{}')
      writeFileSync(join(workspace, 'case_generation', 'test_cases.json'), '{}')
      writeFileSync(
        join(workspace, 'device_scheduling', 'device_bindings.json'),
        '{}',
      )
      writeFileSync(
        join(workspace, 'execution', 'results', 'summary.json'),
        '{}',
      )
      writeFileSync(join(workspace, 'analysis', 'report.json'), '{}')
      writeFileSync(join(workspace, 'analysis', 'report.md'), '# Report')

      const manager = new TaskSessionManager()
      manager.start('task-stepwise-001', 'query')
      manager.patch('task-stepwise-001', { workspace })

      const queryResult: InfTestQueryRunnerResult = {
        task_id: 'task-stepwise-001',
        status: 'SUCCESS',
        run_fake_e2e_invoked: false,
        final_model_reply: 'SUCCESS',
        tool_result: null,
        result_subtype: 'success',
        errors: [],
        orchestration: 'stepwise',
      }

      const finished = finishSessionFromQueryResult(
        manager,
        'task-stepwise-001',
        queryResult,
      )
      expect(finished.artifacts.plan).toBe(join(workspace, 'plan.json'))
      expect(finished.artifacts.test_cases).toBe(
        join(workspace, 'case_generation', 'test_cases.json'),
      )
      expect(finished.artifacts.device_bindings).toBe(
        join(workspace, 'device_scheduling', 'device_bindings.json'),
      )
      expect(finished.artifacts.execution_summary).toBe(
        join(workspace, 'execution', 'results', 'summary.json'),
      )
      expect(finished.artifacts.analysis_report_json).toBe(
        join(workspace, 'analysis', 'report.json'),
      )
      expect(finished.artifacts.analysis_report).toBe(
        join(workspace, 'analysis', 'report.md'),
      )
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('applyControl PAUSE and CONTINUE update session status', () => {
    const manager = new TaskSessionManager()
    manager.start('task-demo-001', 'fake')

    const paused = manager.applyControl('task-demo-001', 'PAUSE')
    expect(paused.session.status).toBe('PAUSED')
    expect(paused.session.stage_history.at(-1)?.trigger).toBe('PAUSE')
    expect(toTaskSessionView(paused.session).message).toContain('paused')

    const continued = manager.applyControl('task-demo-001', 'CONTINUE')
    expect(continued.session.status).toBe('RUNNING')
    expect(continued.session.stage_history.at(-1)?.trigger).toBe('CONTINUE')
    expect(toTaskSessionView(continued.session).message).toContain('running')
  })

  test('applyControl TERMINATE sets TERMINATED and finished_at', () => {
    const manager = new TaskSessionManager()
    manager.start('task-demo-001', 'fake')

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
