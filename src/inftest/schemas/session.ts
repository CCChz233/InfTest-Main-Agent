import { z } from 'zod/v4'
import { InfTestStageSchema, TaskStatusSchema } from './task.js'

export const InfTestRunnerModeSchema = z.enum([
  'fake',
  'query',
  'available',
  'stateful',
])
export type InfTestRunnerMode = z.infer<typeof InfTestRunnerModeSchema>

export const StageTransitionRecordSchema = z.strictObject({
  task_id: z.string().min(1),
  from_stage: InfTestStageSchema.nullable(),
  to_stage: InfTestStageSchema.nullable(),
  from_status: TaskStatusSchema,
  to_status: TaskStatusSchema,
  trigger: z.string().min(1),
  timestamp: z.string(),
  message: z.string().optional(),
})

export type StageTransitionRecord = z.infer<typeof StageTransitionRecordSchema>

export const TaskSessionSchema = z.strictObject({
  task_id: z.string().min(1),
  runner: InfTestRunnerModeSchema,
  status: TaskStatusSchema,
  current_stage: InfTestStageSchema.nullable(),
  previous_stage: InfTestStageSchema.nullable(),
  active_skill: z.string().nullable(),
  blocking_reason: z.string().nullable(),
  stage_history: z.array(StageTransitionRecordSchema),
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

export type InfTestTaskSessionView = z.infer<
  typeof InfTestTaskSessionViewSchema
>
