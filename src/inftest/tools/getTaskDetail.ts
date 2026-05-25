import { z } from 'zod/v4'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { ProxyClient } from '../adapters/ProxyClient.js'
import { InfTestTaskDetailSchema } from '../schemas/task.js'
import { jsonToolResult } from './toolResult.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z.string().min(1),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

type Output = z.infer<typeof InfTestTaskDetailSchema>

export const GetTaskDetailTool = buildTool({
  name: 'get_task_detail',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Get InfTest task detail by task_id'
  },
  async prompt() {
    return 'Fetch task details before planning an InfTest task.'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema() {
    return InfTestTaskDetailSchema
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  renderToolUseMessage() {
    return null
  },
  renderToolResultMessage() {
    return null
  },
  async call({ task_id }) {
    const data = await new ProxyClient().getTaskDetail(task_id)
    return { data }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return jsonToolResult(content, toolUseID)
  },
} satisfies ToolDef<InputSchema, Output>)
