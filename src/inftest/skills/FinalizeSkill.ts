import { ProxyClient } from '../adapters/ProxyClient.js'
import { reportPlanFinalStatusWithUpload } from '../planFinalReporter.js'
import type { InfTestSkill, SkillInput, SkillResult } from './types.js'

export class FinalizeSkill implements InfTestSkill {
  readonly name = 'FinalizeSkill'
  readonly stage = 'COMPLETED' as const

  constructor(private readonly proxyClient = new ProxyClient()) {}

  async run(input: SkillInput): Promise<SkillResult> {
    // COMPLETED is planner-owned and has no AgentName mapping for
    // proxy-update-task-status; per-agent status is already reported at REFLECTING.
    await reportPlanFinalStatusWithUpload({
      task_id: input.task_id,
      task_status: 'SUCCESS',
      workspace: input.workspace,
      message: 'Stateful runner completed',
      proxy_client: this.proxyClient,
    })
    return {
      status: 'SUCCESS',
      artifacts: {},
      message: 'Task finalized',
    }
  }
}
