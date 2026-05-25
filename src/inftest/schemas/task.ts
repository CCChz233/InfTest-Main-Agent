import { z } from 'zod/v4'

export const INFTEST_STAGES = [
  'PLANNING',
  'DATA_GEN',
  'COORDINATE',
  'EXECUTING',
  'REFLECTING',
  'COMPLETED',
] as const

export const InfTestStageSchema = z.enum(INFTEST_STAGES)
export type InfTestStage = z.infer<typeof InfTestStageSchema>

export const TaskOperationSchema = z.enum([
  'START',
  'PAUSE',
  'CONTINUE',
  'TERMINATE',
])
export type TaskOperation = z.infer<typeof TaskOperationSchema>

export const TaskStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'PAUSED',
  'SUCCESS',
  'FAILED',
  'TERMINATED',
])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

export const InfTestTaskDetailSchema = z.strictObject({
  task_id: z.string().min(1),
  task_target: z.string().min(1),
  task_config: z.strictObject({
    enable_case_generation: z.boolean(),
    enable_device_manager: z.boolean(),
    enable_test_execution: z.boolean(),
    enable_result_analysis: z.boolean(),
  }),
})

export type InfTestTaskDetail = z.infer<typeof InfTestTaskDetailSchema>
