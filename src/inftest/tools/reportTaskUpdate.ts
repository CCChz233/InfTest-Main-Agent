import { z } from 'zod/v4'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import {
  ProxyClient,
  type ReportTaskUpdateResult,
} from '../adapters/ProxyClient.js'
import { TaskUpdateSchema } from '../schemas/update.js'
import { jsonToolResult } from './toolResult.js'

const inputSchema = lazySchema(() => TaskUpdateSchema)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.strictObject({
    accepted: z.literal(true),
    event_id: z.string(),
    task_id: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export const ReportTaskUpdateTool = buildTool({
  name: 'report_task_update',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Report InfTest task update through the proxy service'
  },
  async prompt() {
    return [
      'Report task state, stage, case tree, case detail, and final result updates.',
      'Always include event_id for idempotency.',
    ].join(' ')
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
  async call(input) {
    const data: ReportTaskUpdateResult =
      await new ProxyClient().reportTaskUpdate(input)
    return { data }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return jsonToolResult(content, toolUseID)
  },
} satisfies ToolDef<InputSchema, ReportTaskUpdateResult>)
