import { describe, expect, test } from 'bun:test'
import type { InfTestSkill } from '../skills/index.js'
import { SkillRegistry } from '../skills/index.js'

function mockSkill(name: string, stage: InfTestSkill['stage']): InfTestSkill {
  return {
    name,
    stage,
    async run() {
      return {
        status: 'SUCCESS',
        artifacts: {},
      }
    },
  }
}

describe('SkillRegistry', () => {
  test('registers and resolves skills by name and stage', () => {
    const registry = new SkillRegistry()
    const skill = mockSkill('PlanSkill', 'PLANNING')

    registry.register(skill)

    expect(registry.getByName('PlanSkill')).toBe(skill)
    expect(registry.getByStage('PLANNING')).toBe(skill)
    expect(registry.requireByStage('PLANNING')).toBe(skill)
    expect(registry.list()).toEqual([skill])
  })

  test('rejects duplicate names and duplicate stages', () => {
    const registry = new SkillRegistry()
    registry.register(mockSkill('PlanSkill', 'PLANNING'))

    expect(() => registry.register(mockSkill('PlanSkill', 'DATA_GEN'))).toThrow(
      'Skill already registered',
    )
    expect(() =>
      registry.register(mockSkill('AnotherPlanSkill', 'PLANNING')),
    ).toThrow('Stage already has a skill')
  })
})
