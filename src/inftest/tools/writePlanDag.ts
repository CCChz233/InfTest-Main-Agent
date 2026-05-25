import { z } from 'zod/v4'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { WorkspaceManager } from '../adapters/WorkspaceManager.js'
import { PlanDagSchema } from '../schemas/plan.js'
import { jsonToolResult } from './toolResult.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z.string().min(1),
    workspace: z.string().min(1),
    plan_dag: PlanDagSchema,
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z.string(),
    path: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const WritePlanDagTool = buildTool({
  name: 'write_plan_dag',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Write InfTest PlanDAG to plan.json'
  },
  async prompt() {
    return 'Persist the generated InfTest PlanDAG to the task workspace as plan.json.'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  renderToolUseMessage() {
    return null
  },
  renderToolResultMessage() {
    return null
  },
  async call({ task_id, workspace, plan_dag }) {
    const path = await new WorkspaceManager().writeJson(
      workspace,
      'plan.json',
      plan_dag,
    )
    return {
      data: {
        task_id,
        path,
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return jsonToolResult(content, toolUseID)
  },
} satisfies ToolDef<InputSchema, Output>)
