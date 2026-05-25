import { z } from 'zod/v4'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import {
  TaskControlStore,
  type TaskControlState,
} from '../adapters/TaskControlStore.js'
import { TaskOperationSchema } from '../schemas/task.js'
import { jsonToolResult } from './toolResult.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z.string().min(1),
    operation: TaskOperationSchema,
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z.string(),
    status: z.string(),
    updated_at: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export const ControlTaskTool = buildTool({
  name: 'control_task',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Apply an InfTest task control operation'
  },
  async prompt() {
    return 'Apply START, PAUSE, CONTINUE, or TERMINATE to the current InfTest task control state.'
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
  async call({ task_id, operation }) {
    const data: TaskControlState = new TaskControlStore().apply(
      task_id,
      operation,
    )
    return { data }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return jsonToolResult(content, toolUseID)
  },
} satisfies ToolDef<InputSchema, TaskControlState>)
