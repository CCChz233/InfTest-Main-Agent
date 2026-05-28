import { ProxyClient } from '../adapters/ProxyClient.js'
import { WorkspaceManager } from '../adapters/WorkspaceManager.js'
import { buildPlanDag } from './staticArtifacts.js'
import type { InfTestSkill, SkillInput, SkillResult } from './types.js'

export class PlanSkill implements InfTestSkill {
  readonly name = 'PlanSkill'
  readonly stage = 'PLANNING' as const

  constructor(
    private readonly workspaceManager = new WorkspaceManager(),
    private readonly proxyClient = new ProxyClient(),
  ) {}

  async run(input: SkillInput): Promise<SkillResult> {
    const taskDetail = await this.proxyClient.getTaskDetail(input.task_id)
    const taskDetailPath = await this.workspaceManager.writeJson(
      input.workspace,
      'input/task_detail.json',
      taskDetail,
    )
    const planPath = await this.workspaceManager.writeJson(
      input.workspace,
      'plan.json',
      buildPlanDag(input.task_id),
    )
    return {
      status: 'SUCCESS',
      artifacts: {
        task_detail: taskDetailPath,
        plan: planPath,
      },
      message: `Plan generated for ${taskDetail.task_target}`,
    }
  }
}
