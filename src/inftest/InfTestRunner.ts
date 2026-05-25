import type { QueryEngine } from 'src/QueryEngine.js'
import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
import { ProxyClient } from './adapters/ProxyClient.js'
import { WorkspaceManager } from './adapters/WorkspaceManager.js'
import { buildInfTestStartPrompt } from './InfTestPrompt.js'

export class InfTestRunner {
  constructor(
    private readonly queryEngine: QueryEngine,
    private readonly proxyClient = new ProxyClient(),
    private readonly workspaceManager = new WorkspaceManager(),
  ) {}

  async *startTask(taskId: string): AsyncGenerator<SDKMessage, void, unknown> {
    const task = await this.proxyClient.getTaskDetail(taskId)
    const workspace = await this.workspaceManager.init(taskId)
    const prompt = buildInfTestStartPrompt({
      taskId,
      task,
      workspace: workspace.workspace,
    })

    yield* this.queryEngine.submitMessage(prompt)
  }
}
