import { z } from 'zod/v4'

/** POST /tasks/chat/stream — 对齐 InfTest 接口文档 ChatStreamRequest */
export const ChatStreamRequestSchema = z.strictObject({
  user_id: z.string().min(1),
  task_id: z.string().min(1),
  user_instruction: z.string().min(1),
})

export type ChatStreamRequest = z.infer<typeof ChatStreamRequestSchema>

export const ChatStreamChunkSchema = z.strictObject({
  task_id: z.string().min(1),
  chunk: z.string(),
  finished: z.boolean(),
  message_id: z.string().min(1),
  stream_kind: z.enum(['text', 'tool_start', 'tool_end']).optional(),
  tool_name: z.string().optional(),
  tool_use_id: z.string().optional(),
})

export type ChatStreamChunk = z.infer<typeof ChatStreamChunkSchema>
