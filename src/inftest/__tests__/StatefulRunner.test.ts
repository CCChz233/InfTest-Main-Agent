import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { runInfTestStatefulRunner } from '../StatefulRunner.js'
import { TaskSessionManager } from '../TaskSessionManager.js'
import { SkillRegistry, type InfTestSkill } from '../skills/index.js'

let tmpRoot: string | null = null

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true })
    tmpRoot = null
  }
  TaskSessionManager.clearAll()
})

function mockSkill(
  name: string,
  stage: InfTestSkill['stage'],
  artifactPath?: string,
): InfTestSkill {
  return {
    name,
    stage,
    async run(input) {
      const artifacts: Record<string, string> = {}
      if (artifactPath) {
        const path = join(input.workspace, artifactPath)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, JSON.stringify({ ok: true }), 'utf8')
        artifacts[name] = path
      }
      return {
        status: 'SUCCESS',
        artifacts,
        message: `${name} ok`,
      }
    },
  }
}

function createMockRegistry(): SkillRegistry {
  const registry = new SkillRegistry()
  registry.registerMany([
    mockSkill('PlanSkill', 'PLANNING', 'plan.json'),
    mockSkill(
      'StaticCaseGenerationSkill',
      'DATA_GEN',
      'case_generation/test_cases.json',
    ),
    mockSkill(
      'DeviceCoordinateSkill',
      'COORDINATE',
      'device_scheduling/device_case_bind.json',
    ),
    mockSkill('ExecutionSkill', 'EXECUTING', 'execution/results/summary.json'),
    mockSkill('ReportSkill', 'REFLECTING', 'analysis/report.md'),
    mockSkill('FinalizeSkill', 'COMPLETED'),
  ])
  return registry
}

describe('runInfTestStatefulRunner', () => {
  test('runs happy path with mocked skills and writes experiment logs', async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'inftest-stateful-'))

    const result = await runInfTestStatefulRunner({
      task_id: 'task-stateful-happy-001',
      workspace_root: tmpRoot,
      skill_registry: createMockRegistry(),
    })

    expect(result.status).toBe('SUCCESS')
    expect(result.steps.map(step => step.status)).toEqual([
      'SUCCESS',
      'SUCCESS',
      'SUCCESS',
      'SUCCESS',
      'SUCCESS',
      'SUCCESS',
    ])

    const workspace = join(tmpRoot, 'task-stateful-happy-001')
    expect(
      existsSync(join(workspace, 'experiment', 'state_transitions.jsonl')),
    ).toBe(true)
    expect(
      existsSync(join(workspace, 'experiment', 'skill_invocations.jsonl')),
    ).toBe(true)
    expect(existsSync(join(workspace, 'experiment', 'hooks.jsonl'))).toBe(true)
    expect(existsSync(join(workspace, 'experiment', 'summary.md'))).toBe(true)
  })
})
