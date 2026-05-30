import type { TaskSession } from '../schemas/session.js'
import type { InfTestStage } from '../schemas/task.js'

export type SkillInput = {
  task_id: string
  workspace: string
  session: TaskSession
  signal?: AbortSignal
}

export type SkillTelemetry = {
  agent_name?:
    | 'test_generation'
    | 'test_data'
    | 'device_scheduler'
    | 'test_executor'
    | 'result_analyzer'
  total_tokens?: number
  output_json?: string
  step_log?: string
}

export type SkillResult = {
  status: 'SUCCESS' | 'FAILED'
  artifacts: Record<string, string>
  message?: string
  error?: {
    code: string
    message: string
  }
  telemetry?: SkillTelemetry
}

export interface InfTestSkill {
  name: string
  stage: InfTestStage
  run(input: SkillInput): Promise<SkillResult>
}
