import type { TaskSession } from '../schemas/session.js'
import type { InfTestStage } from '../schemas/task.js'

export type SkillInput = {
  task_id: string
  workspace: string
  session: TaskSession
  signal?: AbortSignal
}

export type SkillResult = {
  status: 'SUCCESS' | 'FAILED'
  artifacts: Record<string, string>
  message?: string
  error?: {
    code: string
    message: string
  }
}

export interface InfTestSkill {
  name: string
  stage: InfTestStage
  run(input: SkillInput): Promise<SkillResult>
}
