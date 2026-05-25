import { z } from 'zod/v4'
import { InfTestStageSchema, TaskStatusSchema } from './task.js'

export const TaskUpdateSchema = z.strictObject({
  event_id: z.string().min(1),
  task_id: z.string().min(1),
  task_status: TaskStatusSchema.optional(),
  current_stage: InfTestStageSchema.optional(),
  message: z.string().optional(),
  stage_operations: z.array(z.record(z.string(), z.unknown())).default([]),
  case_node_operations: z.array(z.record(z.string(), z.unknown())).default([]),
  case_detail_operations: z.array(z.record(z.string(), z.unknown())).default([]),
})

export type TaskUpdate = z.infer<typeof TaskUpdateSchema>
