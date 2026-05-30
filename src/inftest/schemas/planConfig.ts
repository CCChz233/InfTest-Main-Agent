import { z } from 'zod/v4'

const DecupConfigSchema = z
  .object({
    top_k: z.number().int().optional(),
    similarity_threshold: z.number().optional(),
    max_overlap_checks: z.number().int().optional(),
  })
  .passthrough()

const CaseGenerateInfoSchema = z
  .object({
    max_depth: z.number().int().optional(),
    included_case_nums: z.number().int().optional(),
  })
  .passthrough()

const CaseExecutionInfoSchema = z
  .object({
    max_case_retry_num: z.number().int().optional(),
    max_timeout_minutes: z.number().int().optional(),
    max_case_step_num: z.number().int().optional(),
    max_step_thinking_seconds: z.number().int().optional(),
    max_concurrency: z.number().int().optional(),
  })
  .passthrough()

const DeviceScheduleInfoSchema = z
  .object({
    max_schedule_device_num: z.number().int().optional(),
  })
  .passthrough()

export const PlanConfigInfoSchema = z
  .object({
    decup_config: DecupConfigSchema.optional(),
    case_generate_info: CaseGenerateInfoSchema.optional(),
    case_execution_info: CaseExecutionInfoSchema.optional(),
    device_schedule_info: DeviceScheduleInfoSchema.optional(),
    included_worker_nums: z.number().int().optional(),
    enable_multimodal: z.boolean().optional(),
    llm_model_config_id: z.number().int().optional(),
    embedding_model_config_id: z.number().int().optional(),
    multimodal_model_config_id: z.number().int().optional(),
  })
  .passthrough()

export type PlanConfigInfo = z.infer<typeof PlanConfigInfoSchema>

export function parsePlanConfigInfo(
  value: unknown,
): PlanConfigInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const parsed = PlanConfigInfoSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Execution timeout in seconds from case_execution_info (doc: max_timeout_minutes). */
export function executionTimeoutSecondsFromConfig(
  config: PlanConfigInfo | null | undefined,
  fallbackSeconds: number,
): number {
  const minutes = config?.case_execution_info?.max_timeout_minutes
  if (typeof minutes === 'number' && minutes > 0) {
    return minutes * 60
  }
  return fallbackSeconds
}
