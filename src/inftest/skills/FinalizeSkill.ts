import { ProxyClient } from '../adapters/ProxyClient.js'
import type { InfTestSkill, SkillInput, SkillResult } from './types.js'

export class FinalizeSkill implements InfTestSkill {
  readonly name = 'FinalizeSkill'
  readonly stage = 'COMPLETED' as const

  constructor(private readonly proxyClient = new ProxyClient()) {}

  async run(input: SkillInput): Promise<SkillResult> {
    await this.proxyClient.reportTaskUpdate({
      event_id: `${input.task_id}:stateful:finalize`,
      task_id: input.task_id,
      task_status: 'SUCCESS',
      current_stage: 'COMPLETED',
      message: 'Stateful runner completed',
      stage_operations: [],
      case_node_operations: [],
      case_detail_operations: [],
    })
    return {
      status: 'SUCCESS',
      artifacts: {},
      message: 'Task finalized',
    }
  }
}
