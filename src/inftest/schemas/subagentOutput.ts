import { z } from 'zod/v4'

export const SubAgentNameSchema = z.enum([
  'test_generation',
  'device_scheduler',
  'test_executor',
  'result_analyzer',
])

export const SubAgentErrorSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string(),
})

export const SubAgentOutputJsonSchema = z.strictObject({
  success: z.boolean(),
  agent_name: SubAgentNameSchema,
  status: z.enum(['SUCCESS', 'FAILED', 'PARTIAL']),
  task_id: z.string().min(1),
  artifacts: z.record(z.string(), z.string()).default({}),
  metrics: z
    .strictObject({
      duration_ms: z.number().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
  error: SubAgentErrorSchema.nullable().optional(),
})

export type SubAgentOutputJson = z.infer<typeof SubAgentOutputJsonSchema>

export function parseSubAgentOutputJson(
  raw: string,
): { ok: true; value: SubAgentOutputJson } | { ok: false; issues: z.core.$ZodIssue[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: 'custom',
          path: [],
          message: 'output-json is not valid JSON',
        } as z.core.$ZodIssue,
      ],
    }
  }
  const result = SubAgentOutputJsonSchema.safeParse(parsed)
  if (result.success) {
    return { ok: true, value: result.data }
  }
  return { ok: false, issues: result.error.issues }
}
