import { z } from 'zod/v4'
import { InfTestStageSchema } from './task.js'

export const PlanDagNodeSchema = z.strictObject({
  id: z.string().min(1),
  stage: InfTestStageSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  depends_on: z.array(z.string().min(1)).optional(),
})

export const PlanDagEdgeSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
})

export const PlanDagSchema = z.strictObject({
  task_id: z.string().min(1),
  version: z.string().min(1),
  nodes: z.array(PlanDagNodeSchema).min(1),
  edges: z.array(PlanDagEdgeSchema),
})

export type PlanDag = z.infer<typeof PlanDagSchema>
