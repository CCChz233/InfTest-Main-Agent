import { z } from 'zod/v4'
import { InfTestStageSchema, TaskStatusSchema } from './task.js'

export const ProxyAgentNameSchema = z.enum([
  'test_generation',
  'test_data',
  'device_scheduler',
  'test_executor',
  'result_analyzer',
])

/** Outbound agent_status values for POST /api/proxy-update-task-status (may differ from internal TaskStatus). */
export const ProxyAgentStatusSchema = z.enum([
  'PENDING',
  'CHECK',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'PAUSED',
  'TERMINATED',
])

export type ProxyAgentStatus = z.infer<typeof ProxyAgentStatusSchema>

export const TaskUpdateSchema = z.strictObject({
  event_id: z.string().min(1),
  exec_id: z.string().min(1).optional(),
  task_id: z.string().min(1),
  task_status: TaskStatusSchema.optional(),
  /** When set, overrides task_status for proxy agent_status enum mapping. */
  proxy_status: ProxyAgentStatusSchema.optional(),
  current_stage: InfTestStageSchema.optional(),
  message: z.string().optional(),
  // Fields backing the 4.1.3 任务状态上报 (UpdateTaskStatusRequest) contract.
  agent_name: ProxyAgentNameSchema.optional(),
  total_tokens: z.number().int().nonnegative().optional(),
  output_json: z.string().optional(),
  step_log: z.string().optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  stage_operations: z.array(z.record(z.string(), z.unknown())).default([]),
  case_node_operations: z.array(z.record(z.string(), z.unknown())).default([]),
  case_detail_operations: z
    .array(z.record(z.string(), z.unknown()))
    .default([]),
})

export type TaskUpdate = z.infer<typeof TaskUpdateSchema>
