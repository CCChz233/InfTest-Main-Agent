import { DeviceCoordinateSkill } from './DeviceCoordinateSkill.js'
import { ExecutionSkill } from './ExecutionSkill.js'
import { FinalizeSkill } from './FinalizeSkill.js'
import { PlanSkill } from './PlanSkill.js'
import { ReportSkill } from './ReportSkill.js'
import { SkillRegistry } from './SkillRegistry.js'
import { StaticCaseGenerationSkill } from './StaticCaseGenerationSkill.js'

export type { InfTestSkill, SkillInput, SkillResult } from './types.js'
export { DeviceCoordinateSkill } from './DeviceCoordinateSkill.js'
export { ExecutionSkill } from './ExecutionSkill.js'
export { FinalizeSkill } from './FinalizeSkill.js'
export { PlanSkill } from './PlanSkill.js'
export { ReportSkill } from './ReportSkill.js'
export { SkillRegistry } from './SkillRegistry.js'
export { StaticCaseGenerationSkill } from './StaticCaseGenerationSkill.js'

export type CreateDefaultSkillRegistryOptions = {
  timeout_seconds?: number
  device_id?: string
}

export function createDefaultSkillRegistry(
  options: CreateDefaultSkillRegistryOptions = {},
): SkillRegistry {
  const registry = new SkillRegistry()
  registry.registerMany([
    new PlanSkill(),
    new StaticCaseGenerationSkill(),
    new DeviceCoordinateSkill(undefined, options.device_id),
    new ExecutionSkill(undefined, options.timeout_seconds),
    new ReportSkill(undefined, options.timeout_seconds),
    new FinalizeSkill(),
  ])
  return registry
}
