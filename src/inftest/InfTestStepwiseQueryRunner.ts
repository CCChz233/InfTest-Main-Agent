import { QueryEngine } from 'src/QueryEngine.js'
import { setSessionPersistenceDisabled } from 'src/bootstrap/state.js'
import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
import { getDefaultAppState } from 'src/state/AppStateStore.js'
import { createStore } from 'src/state/store.js'
import { type Tools } from 'src/Tool.js'
import { createFileStateCacheWithSizeLimit } from 'src/utils/fileStateCache.js'
import { buildInfTestSystemPrompt, buildInfTestStartPrompt } from './InfTestPrompt.js'
import { bootstrapInfTestHeadless } from './headlessBootstrap.js'
import { ProxyClient } from './adapters/ProxyClient.js'
import { WorkspaceManager } from './adapters/WorkspaceManager.js'
import type { InfTestQueryRunnerResult } from './InfTestQueryRunner.js'
import { InfTestTools } from './tools/index.js'

type QueryEngineLike = {
  submitMessage(prompt: string): AsyncGenerator<SDKMessage, void, unknown>
}

type InfTestStepwiseQueryRunnerOptions = {
  cwd?: string
  queryEngine?: QueryEngineLike
  tools?: Tools
  userSpecifiedModel?: string
  maxTurns?: number
  abortController?: AbortController
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function extractAssistantText(message: SDKMessage): string {
  const nested = message.message
  if (!isRecord(nested)) return ''
  const content = nested.content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (!isRecord(block) || block.type !== 'text') return ''
      return typeof block.text === 'string' ? block.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function assistantRequestedInvokeSubagent(message: SDKMessage): boolean {
  const nested = message.message
  if (!isRecord(nested)) return false
  const content = nested.content
  if (!Array.isArray(content)) return false
  return content.some(
    block =>
      isRecord(block) &&
      block.type === 'tool_use' &&
      block.name === 'invoke_subagent',
  )
}

function createDefaultQueryEngine(
  cwd: string,
  tools: Tools,
  options: InfTestStepwiseQueryRunnerOptions,
): QueryEngine {
  bootstrapInfTestHeadless()
  setSessionPersistenceDisabled(true)
  const appStore = createStore(getDefaultAppState())
  const system = `${buildInfTestSystemPrompt()}

Stepwise orchestration mode:
- run_fake_e2e is NOT available. Use the individual InfTest tools in order.
- You must call invoke_subagent at least once for a business stage.
- Finish by calling report_task_update with task_status SUCCESS or FAILED.`
  return new QueryEngine({
    cwd,
    tools,
    commands: [],
    mcpClients: [],
    agents: [],
    canUseTool: async (
      _tool,
      input,
      _context,
      _assistantMessage,
      _toolUseId,
      forceDecision,
    ) =>
      forceDecision ?? {
        behavior: 'allow',
        updatedInput: input,
      },
    getAppState: appStore.getState,
    setAppState: appStore.setState,
    readFileCache: createFileStateCacheWithSizeLimit(100),
    customSystemPrompt: system,
    userSpecifiedModel:
      options.userSpecifiedModel ?? process.env.INFTEST_MODEL,
    maxTurns: options.maxTurns ?? 32,
    ...(options.abortController ? { abortController: options.abortController } : {}),
  })
}

export class InfTestStepwiseQueryRunner {
  constructor(private readonly options: InfTestStepwiseQueryRunnerOptions = {}) {}

  async runTask(taskId: string): Promise<InfTestQueryRunnerResult> {
    const proxy = new ProxyClient()
    const workspaceManager = new WorkspaceManager()
    const workspace = workspaceManager.getTaskWorkspace(taskId)
    const task = await proxy.getTaskDetail(taskId)

    const engine =
      this.options.queryEngine ??
      createDefaultQueryEngine(
        this.options.cwd ?? process.cwd(),
        this.options.tools ?? InfTestTools,
        this.options,
      )

    const prompt = [
      buildInfTestStartPrompt({
        taskId,
        task,
        workspace,
      }),
      'Execute the full InfTest workflow using tools (stepwise mode).',
      'Do not skip invoke_subagent for business stages.',
    ].join('\n')

    let finalModelReply = ''
    let resultSubtype: string | null = null
    const errors: string[] = []
    let invokeSubagentInvoked = false

    for await (const message of engine.submitMessage(prompt)) {
      if (message.type === 'assistant') {
        if (assistantRequestedInvokeSubagent(message)) {
          invokeSubagentInvoked = true
        }
        const text = extractAssistantText(message)
        if (text) finalModelReply = text
      }
      if (message.type === 'result') {
        resultSubtype =
          typeof message.subtype === 'string' ? message.subtype : null
        if (Array.isArray(message.errors)) {
          errors.push(...message.errors.map(String))
        }
        if (typeof message.result === 'string' && message.result) {
          finalModelReply = message.result
        }
        if (resultSubtype && resultSubtype !== 'success') {
          errors.push(`query_result_subtype:${resultSubtype}`)
        }
      }
    }

    const status =
      errors.length === 0 &&
      resultSubtype === 'success' &&
      invokeSubagentInvoked
        ? 'SUCCESS'
        : 'FAILED'

    if (!invokeSubagentInvoked) {
      errors.push('invoke_subagent was not invoked')
    }

    return {
      task_id: taskId,
      status,
      run_fake_e2e_invoked: false,
      invoke_subagent_invoked: invokeSubagentInvoked,
      final_model_reply: finalModelReply,
      tool_result: null,
      result_subtype: resultSubtype,
      errors,
      orchestration: 'stepwise',
    }
  }
}
