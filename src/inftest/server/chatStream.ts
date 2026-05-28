import { randomUUID } from 'crypto'
import { isAnthropicAuthEnabled } from 'src/utils/auth.js'
import { bootstrapInfTestHeadless } from '../headlessBootstrap.js'
import {
  streamInfTestChatChunks,
  type InfTestChatStreamerOptions,
} from '../InfTestChatStreamer.js'
import { ChatStreamRequestSchema } from '../schemas/chat.js'
import type { ChatStreamChunk } from '../schemas/chat.js'
import type { ChatStreamSseEnvelope } from '../schemas/api.js'
import type { TaskSessionManager } from '../TaskSessionManager.js'
import { API_CODE_SUCCESS, apiError, jsonApiResponse } from './apiResponse.js'

function formatSseEnvelope(envelope: ChatStreamSseEnvelope): string {
  return `data: ${JSON.stringify(envelope)}\n\n`
}

export type HandleChatStreamDeps = {
  streamChunks?: (
    options: InfTestChatStreamerOptions,
  ) => AsyncGenerator<ChatStreamChunk>
  isAuthEnabled?: () => boolean
}

export async function handleChatStream(
  request: Request,
  sessionManager: TaskSessionManager,
  deps: HandleChatStreamDeps = {},
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonApiResponse(apiError(405, 'Method not allowed'), 405)
  }

  let body: unknown
  try {
    const text = await request.text()
    body = text.trim() === '' ? {} : (JSON.parse(text) as unknown)
  } catch {
    return jsonApiResponse(apiError(400, 'Invalid JSON body'), 400)
  }

  const parsed = ChatStreamRequestSchema.safeParse(body)
  if (!parsed.success) {
    return jsonApiResponse(
      apiError(
        400,
        `Invalid chat stream request: ${JSON.stringify(parsed.error.issues)}`,
      ),
      400,
    )
  }

  const { user_instruction, user_id } = parsed.data
  const execId = parsed.data.exec_id ?? parsed.data.task_id
  if (!execId) {
    return jsonApiResponse(apiError(400, 'exec_id is required'), 400)
  }
  const session = sessionManager.get(execId)
  if (!session) {
    return jsonApiResponse(
      apiError(
        404,
        `Exec task not found: ${execId}. Call POST /tasks/alter with START first.`,
      ),
      404,
    )
  }

  bootstrapInfTestHeadless()
  const authEnabled = deps.isAuthEnabled ?? isAnthropicAuthEnabled
  if (
    !authEnabled() &&
    !process.env.ANTHROPIC_API_KEY &&
    !process.env.ANTHROPIC_AUTH_TOKEN &&
    !process.env.OPENAI_API_KEY
  ) {
    return jsonApiResponse(
      apiError(
        503,
        'Model credentials required for /tasks/chat/stream. Set ANTHROPIC_* or OPENAI_API_KEY or run /login in CCB.',
      ),
      503,
    )
  }

  const messageId = randomUUID()
  const streamChunks = deps.streamChunks ?? streamInfTestChatChunks

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        for await (const chunk of streamChunks({
          session,
          userInstruction: user_instruction,
          userId: user_id,
          messageId,
        })) {
          const data = {
            ...chunk,
            exec_id: chunk.exec_id ?? chunk.task_id,
          }
          controller.enqueue(
            encoder.encode(
              formatSseEnvelope({
                code: API_CODE_SUCCESS,
                message: '',
                data,
              }),
            ),
          )
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        controller.enqueue(
          encoder.encode(
            formatSseEnvelope({
              code: 500,
              message,
              data: {
                exec_id: execId,
                task_id: execId,
                chunk: message,
                finished: true,
                message_id: messageId,
              },
            }),
          ),
        )
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
}
