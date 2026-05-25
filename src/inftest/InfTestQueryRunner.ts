import { QueryEngine } from 'src/QueryEngine.js'
import { setSessionPersistenceDisabled } from 'src/bootstrap/state.js'
import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
import { getDefaultAppState } from 'src/state/AppStateStore.js'
import { createStore } from 'src/state/store.js'
import { type Tools } from 'src/Tool.js'
import { createFileStateCacheWithSizeLimit } from 'src/utils/fileStateCache.js'
import {
  buildInfTestQueryRunnerSystemPrompt,
} from './InfTestPrompt.js'
import type { InfTestFakeE2EResult } from './FakeE2ERunner.js'
import { bootstrapInfTestHeadless } from './headlessBootstrap.js'
import { InfTestQueryTools } from './tools/index.js'

export type InfTestQueryRunnerResult = {
  task_id: string
  status: 'SUCCESS' | 'FAILED'
  run_fake_e2e_invoked: boolean
  final_model_reply: string
  tool_result: InfTestFakeE2EResult | null
  result_subtype: string | null
  errors: string[]
  orchestration?: 'aggregate' | 'stepwise'
  invoke_subagent_invoked?: boolean
}

type QueryEngineLike = {
  submitMessage(prompt: string): AsyncGenerator<SDKMessage, void, unknown>
}

type InfTestQueryRunnerOptions = {
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

function assistantRequestedRunFakeE2E(message: SDKMessage): boolean {
  const nested = message.message
  if (!isRecord(nested)) return false
  const content = nested.content
  if (!Array.isArray(content)) return false
  return content.some(
    block =>
      isRecord(block) &&
      block.type === 'tool_use' &&
      block.name === 'run_fake_e2e',
  )
}

function isFakeE2EResult(value: unknown): value is InfTestFakeE2EResult {
  if (!isRecord(value)) return false
  return (
    typeof value.task_id === 'string' &&
    (value.status === 'SUCCESS' || value.status === 'FAILED') &&
    typeof value.workspace === 'string' &&
    isRecord(value.artifacts) &&
    Array.isArray(value.steps)
  )
}

function parseToolResult(value: unknown): InfTestFakeE2EResult | null {
  if (isFakeE2EResult(value)) return value
  if (isRecord(value) && 'data' in value) {
    return parseToolResult(value.data)
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return parseToolResult(parsed)
    } catch {
      return null
    }
  }
  if (isRecord(value) && 'content' in value) {
    return parseToolResult(value.content)
  }
  return null
}

function parseToolResultFromUserMessage(message: SDKMessage): InfTestFakeE2EResult | null {
  const direct = parseToolResult(message.tool_use_result)
  if (direct) return direct

  const nested = message.message
  if (!isRecord(nested)) return null
  const content = nested.content
  if (!Array.isArray(content)) return null

  for (const block of content) {
    if (!isRecord(block) || block.type !== 'tool_result') continue
    const parsed = parseToolResult(block.content)
    if (parsed) return parsed
  }
  return null
}

function createDefaultQueryEngine(
  cwd: string,
  tools: Tools,
  options: InfTestQueryRunnerOptions,
): QueryEngine {
  bootstrapInfTestHeadless()
  setSessionPersistenceDisabled(true)
  const appStore = createStore(getDefaultAppState())
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
    customSystemPrompt: buildInfTestQueryRunnerSystemPrompt(),
    userSpecifiedModel:
      options.userSpecifiedModel ?? process.env.INFTEST_MODEL,
    maxTurns: options.maxTurns ?? 8,
    ...(options.abortController ? { abortController: options.abortController } : {}),
  })
}

export class InfTestQueryRunner {
  constructor(private readonly options: InfTestQueryRunnerOptions = {}) {}

  async runTask(taskId: string): Promise<InfTestQueryRunnerResult> {
    const engine =
      this.options.queryEngine ??
      createDefaultQueryEngine(
        this.options.cwd ?? process.cwd(),
        this.options.tools ?? InfTestQueryTools,
        this.options,
      )
    const prompt = [
      `Start InfTest fake E2E task ${taskId}.`,
      'You must call run_fake_e2e exactly once.',
      `Use input: {"task_id":"${taskId}"}.`,
      'After the tool returns, reply with SUCCESS and a one-line summary.',
    ].join(' ')

    let finalModelReply = ''
    let toolResult: InfTestFakeE2EResult | null = null
    let resultSubtype: string | null = null
    let runFakeE2EInvoked = false
    const errors: string[] = []

    for await (const message of engine.submitMessage(prompt)) {
      if (message.type === 'assistant') {
        if (assistantRequestedRunFakeE2E(message)) {
          runFakeE2EInvoked = true
        }
        const text = extractAssistantText(message)
        if (text) finalModelReply = text
      }
      if (message.type === 'user') {
        const parsed = parseToolResultFromUserMessage(message)
        if (parsed) {
          toolResult = parsed
          runFakeE2EInvoked = true
        }
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

    const status = toolResult?.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED'
    if (!runFakeE2EInvoked) {
      errors.push('run_fake_e2e was not invoked')
    }

    return {
      task_id: taskId,
      status,
      run_fake_e2e_invoked: runFakeE2EInvoked,
      final_model_reply: finalModelReply,
      tool_result: toolResult,
      result_subtype: resultSubtype,
      errors,
      orchestration: 'aggregate',
    }
  }
}

export const internalInfTestQueryRunnerTestUtils = {
  extractAssistantText,
  parseToolResult,
  parseToolResultFromUserMessage,
  assistantRequestedRunFakeE2E,
}
