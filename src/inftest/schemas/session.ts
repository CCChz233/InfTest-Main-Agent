import { z } from 'zod/v4'
import { TaskStatusSchema } from './task.js'

export const InfTestRunnerModeSchema = z.enum(['fake', 'query'])
export type InfTestRunnerMode = z.infer<typeof InfTestRunnerModeSchema>

export const TaskSessionSchema = z.strictObject({
  task_id: z.string().min(1),
  runner: InfTestRunnerModeSchema,
  status: TaskStatusSchema,
  workspace: z.string(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  last_error: z.string().nullable(),
  run_fake_e2e_invoked: z.boolean(),
  artifacts: z.record(z.string(), z.string()),
})

export type TaskSession = z.infer<typeof TaskSessionSchema>

/** Internal START result shape (mapped into POST /tasks/alter data) */
export const InfTestTaskResponseSchema = z.strictObject({
  task_id: z.string().min(1),
  runner: InfTestRunnerModeSchema,
  status: z.enum(['SUCCESS', 'FAILED']),
  workspace: z.string(),
  artifacts: z.record(z.string(), z.string()),
  message: z.string(),
})

export type InfTestTaskResponse = z.infer<typeof InfTestTaskResponseSchema>

/** Full session view for internal tooling */
export const InfTestTaskSessionViewSchema = TaskSessionSchema.extend({
  message: z.string(),
})

export type InfTestTaskSessionView = z.infer<typeof InfTestTaskSessionViewSchema>
