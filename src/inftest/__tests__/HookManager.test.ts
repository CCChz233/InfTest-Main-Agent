import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { HookManager } from '../HookManager.js'
import { InfTestStateMachine } from '../InfTestStateMachine.js'
import { TaskSessionManager } from '../TaskSessionManager.js'
import type { InfTestSkill } from '../skills/index.js'

let tmpRoot: string | null = null

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true })
    tmpRoot = null
  }
  TaskSessionManager.clearAll()
})

const skill: InfTestSkill = {
  name: 'PlanSkill',
  stage: 'PLANNING',
  async run() {
    return {
      status: 'SUCCESS',
      artifacts: {},
    }
  },
}

function readJsonl(path: string): unknown[] {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as unknown)
}

describe('HookManager', () => {
  test('writes hook, skill invocation, transition, and summary logs', async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'inftest-hooks-'))
    const manager = new TaskSessionManager()
    const stateMachine = new InfTestStateMachine()
    let session = manager.start('task-hooks-001', 'stateful')
    session = stateMachine.start(session)

    const hooks = new HookManager(tmpRoot)
    await hooks.onTaskStart(session)
    await hooks.onEnterStage(session)
    await hooks.beforeSkillCall(session, skill)
    await hooks.afterSkillCall(
      session,
      skill,
      { status: 'SUCCESS', artifacts: { plan: '/tmp/plan.json' } },
      12,
    )
    await hooks.recordStateTransition(session.stage_history[0])
    await hooks.onTaskFinish(session, {
      status: 'SUCCESS',
      message: 'done',
      artifacts: { plan: '/tmp/plan.json' },
    })

    const experiment = join(tmpRoot, 'experiment')
    expect(readJsonl(join(experiment, 'hooks.jsonl')).length).toBeGreaterThan(0)
    expect(readJsonl(join(experiment, 'skill_invocations.jsonl')).length).toBe(
      2,
    )
    expect(readJsonl(join(experiment, 'state_transitions.jsonl')).length).toBe(
      1,
    )
    expect(readFileSync(join(experiment, 'summary.md'), 'utf8')).toContain(
      'task-hooks-001',
    )
  })
})
