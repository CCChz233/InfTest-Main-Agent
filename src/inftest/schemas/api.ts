import { z } from 'zod/v4'
import { ChatStreamChunkSchema } from './chat.js'

const ExecIdFieldsSchema = {
  exec_id: z.string().min(1).optional(),
  task_id: z.string().min(1).optional(),
}

function hasExecId(value: { exec_id?: string; task_id?: string }): boolean {
  return Boolean(value.exec_id ?? value.task_id)
}

export function resolveExecId(value: {
  exec_id?: string
  task_id?: string
}): string {
  const execId = value.exec_id ?? value.task_id
  if (!execId) {
    throw new Error('exec_id is required')
  }
  return execId
}

/** POST /tasks/alter — 文档 1.2.3.3 */
export const AlterTaskRequestSchema = z
  .strictObject({
    task_operation: z.enum(['START', 'PAUSE', 'CONTINUE']),
    ...ExecIdFieldsSchema,
  })
  .refine(hasExecId, {
    message: 'exec_id is required',
    path: ['exec_id'],
  })

export type AlterTaskRequest = z.infer<typeof AlterTaskRequestSchema>

/** POST /tasks/terminate — 文档 1.2.3.4 */
export const TerminateTaskRequestSchema = z
  .strictObject({
    ...ExecIdFieldsSchema,
    project_id: z.string().optional(),
  })
  .refine(hasExecId, {
    message: 'exec_id is required',
    path: ['exec_id'],
  })

export type TerminateTaskRequest = z.infer<typeof TerminateTaskRequestSchema>

/** 任务详情（对齐文档 GetTaskDetail / Planner 会话字段的 MVP 映射） */
export const TaskDetailSchema = z.strictObject({
  exec_id: z.string(),
  task_id: z.string(),
  task_status: z.string(),
  current_stage: z.string().nullable(),
  previous_stage: z.string().nullable(),
  active_skill: z.string().nullable(),
  blocking_reason: z.string().nullable(),
  stage_history: z.array(z.record(z.string(), z.unknown())),
  workspace: z.string(),
  runner: z.string(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  last_error: z.string().nullable(),
  run_fake_e2e_invoked: z.boolean(),
  artifacts: z.record(z.string(), z.string()),
  message: z.string(),
})

export type TaskDetail = z.infer<typeof TaskDetailSchema>

export const GetTaskDetailDataSchema = z.strictObject({
  task_detail: TaskDetailSchema,
})

export const ApiEnvelopeSchema = z.strictObject({
  code: z.number().int(),
  message: z.string(),
})

export const ApiDataEnvelopeSchema = ApiEnvelopeSchema.extend({
  data: z.unknown(),
})

/** POST /tasks/chat/stream SSE 单条 — 文档 ChatStreamResponse */
export const ChatStreamSseEnvelopeSchema = z.strictObject({
  code: z.number().int(),
  message: z.string(),
  data: ChatStreamChunkSchema,
})

export type ChatStreamSseEnvelope = z.infer<typeof ChatStreamSseEnvelopeSchema>

export const InfTestStepRecordSchema = z.strictObject({
  name: z.string(),
  status: z.enum(['SUCCESS', 'FAILED']),
  duration_ms: z.number(),
  message: z.string().optional(),
})

export const StartTaskDataSchema = z.strictObject({
  exec_id: z.string(),
  task_id: z.string(),
  task_status: z.string(),
  current_stage: z.string().nullable().optional(),
  workspace: z.string(),
  runner: z.string(),
  artifacts: z.record(z.string(), z.string()),
  run_fake_e2e_invoked: z.boolean(),
  orchestration: z.enum(['aggregate', 'stepwise', 'stateful']).optional(),
  steps: z.array(InfTestStepRecordSchema).optional(),
})

export type StartTaskData = z.infer<typeof StartTaskDataSchema>
