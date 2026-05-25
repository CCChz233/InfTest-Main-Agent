import { z } from 'zod/v4'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import {
  DEFAULT_INFTEST_FAKE_TASK_ID,
  runInfTestFakeE2E,
  type InfTestFakeE2EResult,
} from '../FakeE2ERunner.js'
import { jsonToolResult } from './toolResult.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z.string().min(1).default(DEFAULT_INFTEST_FAKE_TASK_ID),
    workspace_root: z.string().optional(),
    timeout_seconds: z.number().int().positive().optional(),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z.string(),
    status: z.enum(['SUCCESS', 'FAILED']),
    workspace: z.string(),
    plan_path: z.string().nullable(),
    artifacts: z.record(z.string(), z.string()),
    reported_cases: z.array(z.string()),
    summary_found: z.boolean(),
    steps: z.array(
      z.strictObject({
        name: z.string(),
        status: z.enum(['SUCCESS', 'FAILED']),
        duration_ms: z.number(),
        message: z.string().optional(),
      }),
    ),
    error: z.string().nullable(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export const RunFakeE2ETool = buildTool({
  name: 'run_fake_e2e',
  maxResultSizeChars: 300_000,
  async description() {
    return 'Run the deterministic InfTest fake E2E workflow'
  },
  async prompt() {
    return [
      'Run the deterministic fake InfTest end-to-end workflow for a task.',
      'Use this tool in query-runner mode instead of calling sub agents directly.',
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
    const data = await runInfTestFakeE2E(input)
    return { data }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return jsonToolResult(content, toolUseID)
  },
} satisfies ToolDef<InputSchema, InfTestFakeE2EResult>)
