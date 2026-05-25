import { z } from 'zod/v4'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import {
  type InitWorkspaceResult,
  WorkspaceManager,
} from '../adapters/WorkspaceManager.js'
import { jsonToolResult } from './toolResult.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z.string().min(1),
    workspace_root: z.string().optional(),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.strictObject({
    task_id: z.string(),
    workspace: z.string(),
    directories: z.array(z.string()),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const InitWorkspaceTool = buildTool({
  name: 'init_workspace',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Initialize InfTest workspace directories for a task'
  },
  async prompt() {
    return 'Create the workspace directory tree for an InfTest task before writing artifacts.'
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
  async call({ task_id, workspace_root }) {
    const data: InitWorkspaceResult = await new WorkspaceManager(
      workspace_root,
    ).init(task_id)
    return { data }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return jsonToolResult(content, toolUseID)
  },
} satisfies ToolDef<InputSchema, Output>)
