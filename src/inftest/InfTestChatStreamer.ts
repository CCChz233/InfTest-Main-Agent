import { randomUUID } from 'crypto'
import { QueryEngine } from 'src/QueryEngine.js'
import { setSessionPersistenceDisabled } from 'src/bootstrap/state.js'
import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
import { getDefaultAppState } from 'src/state/AppStateStore.js'
import { createStore } from 'src/state/store.js'
import { createFileStateCacheWithSizeLimit } from 'src/utils/fileStateCache.js'
import { bootstrapInfTestHeadless } from './headlessBootstrap.js'
import {
  buildInfTestChatSystemPrompt,
  buildInfTestChatUserPrompt,
} from './InfTestPrompt.js'
import type { ChatStreamChunk } from './schemas/chat.js'
import type { TaskSession } from './schemas/session.js'
import { buildTaskMessage } from './TaskSessionManager.js'

type QueryEngineLike = {
  submitMessage(
    prompt: string,
    options?: { uuid?: string; isMeta?: boolean },
  ): AsyncGenerator<SDKMessage, void, unknown>
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
    .join('')
}

function extractToolUses(
  message: SDKMessage,
): { name: string; id: string }[] {
  const nested = message.message
  if (!isRecord(nested)) return []
  const content = nested.content
  if (!Array.isArray(content)) return []
  const tools: { name: string; id: string }[] = []
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'tool_use') continue
    const name = typeof block.name === 'string' ? block.name : ''
    const id = typeof block.id === 'string' ? block.id : ''
    if (name) tools.push({ name, id })
  }
  return tools
}

function extractToolResultMeta(message: SDKMessage): {
  toolUseId: string
  name: string
} | null {
  const nested = message.message
  if (!isRecord(nested)) return null
  const content = nested.content
  if (!Array.isArray(content)) return null
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'tool_result') continue
    const toolUseId =
      typeof block.tool_use_id === 'string' ? block.tool_use_id : ''
    const name = typeof block.name === 'string' ? block.name : 'tool'
    if (toolUseId) return { toolUseId, name }
  }
  return null
}

function extractTextDeltaFromStreamEvent(message: SDKMessage): string | null {
  if (message.type !== 'stream_event') return null
  const event = (message as { event?: unknown }).event
  if (!isRecord(event) || event.type !== 'content_block_delta') return null
  const delta = event.delta
  if (!isRecord(delta) || delta.type !== 'text_delta') return null
  return typeof delta.text === 'string' ? delta.text : null
}

export function createInfTestChatQueryEngine(cwd = process.cwd()): QueryEngine {
  bootstrapInfTestHeadless()
  setSessionPersistenceDisabled(true)
  const appStore = createStore(getDefaultAppState())
  return new QueryEngine({
    cwd,
    tools: [],
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
    customSystemPrompt: buildInfTestChatSystemPrompt(),
    userSpecifiedModel: process.env.INFTEST_MODEL,
    maxTurns: 2,
    includePartialMessages: true,
  })
}

export type InfTestChatStreamerOptions = {
  session: TaskSession
  userInstruction: string
  userId?: string
  messageId?: string
  queryEngine?: QueryEngineLike
  cwd?: string
}

export async function* streamInfTestChatChunks(
  options: InfTestChatStreamerOptions,
): AsyncGenerator<ChatStreamChunk> {
  const messageId = options.messageId ?? randomUUID()
  const taskId = options.session.task_id
  const engine =
    options.queryEngine ??
    createInfTestChatQueryEngine(options.cwd ?? process.cwd())

  const taskSummary = buildTaskMessage(options.session)
  const prompt = buildInfTestChatUserPrompt({
    taskId,
    userInstruction: options.userInstruction,
    status: options.session.status,
    workspace: options.session.workspace,
    artifacts: options.session.artifacts,
    lastError: options.session.last_error,
    runFakeE2EInvoked: options.session.run_fake_e2e_invoked,
    runner: options.session.runner,
    startedAt: options.session.started_at,
    finishedAt: options.session.finished_at,
    userId: options.userId,
    taskSummary,
  })

  let streamedAnyText = false
  let lastAssistantText = ''

  for await (const message of engine.submitMessage(prompt)) {
    const delta = extractTextDeltaFromStreamEvent(message)
    if (delta) {
      streamedAnyText = true
      yield {
        task_id: taskId,
        chunk: delta,
        finished: false,
        message_id: messageId,
        stream_kind: 'text',
      }
    }

    if (message.type === 'assistant') {
      const text = extractAssistantText(message)
      if (text) lastAssistantText = text
      for (const tool of extractToolUses(message)) {
        yield {
          task_id: taskId,
          chunk: '',
          finished: false,
          message_id: messageId,
          stream_kind: 'tool_start',
          tool_name: tool.name,
          tool_use_id: tool.id,
        }
      }
    }

    if (message.type === 'user') {
      const toolMeta = extractToolResultMeta(message)
      if (toolMeta) {
        yield {
          task_id: taskId,
          chunk: '',
          finished: false,
          message_id: messageId,
          stream_kind: 'tool_end',
          tool_name: toolMeta.name,
          tool_use_id: toolMeta.toolUseId,
        }
      }
    }

    if (message.type === 'result') {
      const finalText =
        typeof message.result === 'string' && message.result
          ? message.result
          : lastAssistantText
      if (finalText && !streamedAnyText) {
        yield {
          task_id: taskId,
          chunk: finalText,
          finished: false,
          message_id: messageId,
          stream_kind: 'text',
        }
      }
      yield {
        task_id: taskId,
        chunk: '',
        finished: true,
        message_id: messageId,
      }
      return
    }
  }

  yield {
    task_id: taskId,
    chunk: lastAssistantText || '',
    finished: true,
    message_id: messageId,
  }
}

export const internalInfTestChatStreamerTestUtils = {
  extractTextDeltaFromStreamEvent,
  extractAssistantText,
  extractToolUses,
  extractToolResultMeta,
}
