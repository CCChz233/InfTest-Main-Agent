import { z } from 'zod/v4'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import {
  SubAgentAdapter,
  SUBAGENT_NAMES,
  type InvokeSubAgentOutput,
} from '../adapters/SubAgentAdapter.js'
import { SubAgentOutputJsonSchema } from '../schemas/subagentOutput.js'
import { getRegisteredInfTestSessionManager } from '../taskSessionRegistry.js'
import { jsonToolResult } from './toolResult.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    agent_name: z.enum(SUBAGENT_NAMES),
    task_id: z.string().min(1),
    workspace: z.string().min(1),
    output_json: z.string().min(1),
    timeout_seconds: z.number().int().positive().optional(),
    extra_args: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.strictObject({
    success: z.boolean(),
    agent_name: z.enum(SUBAGENT_NAMES),
    output_json: z.string(),
    exit_code: z.number().nullable(),
    stdout_log: z.string(),
    stderr_log: z.string(),
    duration_ms: z.number(),
    error: z.string().nullable(),
    output: SubAgentOutputJsonSchema.optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

function pausedRefusalOutput(
  input: z.infer<InputSchema>,
): InvokeSubAgentOutput {
  return {
    success: false,
    agent_name: input.agent_name,
    output_json: input.output_json,
    exit_code: null,
    stdout_log: '',
    stderr_log: '',
    duration_ms: 0,
    error:
      'Task is PAUSED (stepwise mode): invoke_subagent blocked until CONTINUE',
  }
}

export const InvokeSubagentTool = buildTool({
  name: 'invoke_subagent',
  maxResultSizeChars: 200_000,
  async description() {
    return 'Invoke a controlled InfTest sub agent by name'
  },
  async prompt() {
    return [
      'Invoke business sub agents using fixed internal command mappings.',
      'Do not use shell commands directly.',
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
    const orchestration = process.env.INFTEST_ORCHESTRATION ?? 'aggregate'
    if (orchestration === 'stepwise') {
      const mgr = getRegisteredInfTestSessionManager()
      const session = mgr?.get(input.task_id)
      if (session?.status === 'PAUSED') {
        return { data: pausedRefusalOutput(input) }
      }
    }

    const data: InvokeSubAgentOutput = await new SubAgentAdapter().invoke(input)
    return { data }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return jsonToolResult(content, toolUseID)
  },
} satisfies ToolDef<InputSchema, InvokeSubAgentOutput>)
