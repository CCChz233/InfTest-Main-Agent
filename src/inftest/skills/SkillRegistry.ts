import type { InfTestStage } from '../schemas/task.js'
import type { InfTestSkill } from './types.js'

export class SkillRegistry {
  private readonly byName = new Map<string, InfTestSkill>()
  private readonly byStage = new Map<InfTestStage, InfTestSkill>()

  register(skill: InfTestSkill): void {
    if (this.byName.has(skill.name)) {
      throw new Error(`Skill already registered: ${skill.name}`)
    }
    if (this.byStage.has(skill.stage)) {
      throw new Error(`Stage already has a skill: ${skill.stage}`)
    }
    this.byName.set(skill.name, skill)
    this.byStage.set(skill.stage, skill)
  }

  registerMany(skills: InfTestSkill[]): void {
    for (const skill of skills) {
      this.register(skill)
    }
  }

  getByName(name: string): InfTestSkill | undefined {
    return this.byName.get(name)
  }

  getByStage(stage: InfTestStage): InfTestSkill | undefined {
    return this.byStage.get(stage)
  }

  requireByStage(stage: InfTestStage): InfTestSkill {
    const skill = this.getByStage(stage)
    if (!skill) {
      throw new Error(`No skill registered for stage: ${stage}`)
    }
    return skill
  }

  list(): InfTestSkill[] {
    return [...this.byName.values()]
  }
}
