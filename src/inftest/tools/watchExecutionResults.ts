import { z } from 'zod/v4'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import {
  ExecutionResultWatcher,
  type WatchExecutionResultsOutput,
} from '../adapters/ExecutionResultWatcher.js'
import { jsonToolResult } from './toolResult.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z.string().min(1),
    results_dir: z.string().min(1),
    summary_path: z.string().min(1),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z.string(),
    reported_cases: z.array(z.string()),
    summary_found: z.boolean(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export const WatchExecutionResultsTool = buildTool({
  name: 'watch_execution_results',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Scan execution results and report per-case updates'
  },
  async prompt() {
    return [
      'Watch or scan execution result files, report each case result,',
      'and reconcile with summary.json.',
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
    const data = await new ExecutionResultWatcher().watch(input)
    return {
      data,
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return jsonToolResult(content, toolUseID)
  },
} satisfies ToolDef<InputSchema, WatchExecutionResultsOutput>)
