import { z } from 'zod/v4'

/** POST /tasks/chat/stream — 对齐 InfTest 接口文档 ChatStreamRequest */
export const ChatStreamRequestSchema = z
  .strictObject({
    user_id: z.string().min(1),
    exec_id: z.string().min(1).optional(),
    task_id: z.string().min(1).optional(),
    user_instruction: z.string().min(1),
  })
  .refine(value => Boolean(value.exec_id ?? value.task_id), {
    message: 'exec_id is required',
    path: ['exec_id'],
  })

export type ChatStreamRequest = z.infer<typeof ChatStreamRequestSchema>

export const ChatStreamChunkSchema = z.strictObject({
  exec_id: z.string().min(1).optional(),
  task_id: z.string().min(1),
  chunk: z.string(),
  finished: z.boolean(),
  message_id: z.string().min(1),
  stream_kind: z.enum(['text', 'tool_start', 'tool_end']).optional(),
  tool_name: z.string().optional(),
  tool_use_id: z.string().optional(),
})

export type ChatStreamChunk = z.infer<typeof ChatStreamChunkSchema>
