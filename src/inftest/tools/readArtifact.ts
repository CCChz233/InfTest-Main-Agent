import { z } from 'zod/v4'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { WorkspaceManager } from '../adapters/WorkspaceManager.js'
import { jsonToolResult } from './toolResult.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    workspace: z.string().min(1),
    path: z.string().min(1),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.strictObject({
    path: z.string(),
    content: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const ReadArtifactTool = buildTool({
  name: 'read_artifact',
  maxResultSizeChars: 1_000_000,
  async description() {
    return 'Read an artifact from the InfTest workspace'
  },
  async prompt() {
    return [
      'Read an existing file artifact from the task workspace.',
      'Use relative paths inside the workspace.',
    ].join(' ')
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
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
  async call({ workspace, path }) {
    const manager = new WorkspaceManager()
    const resolved = manager.resolveArtifactPath(workspace, path)
    const content = await manager.readText(workspace, path)
    return {
      data: {
        path: resolved,
        content,
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return jsonToolResult(content, toolUseID)
  },
} satisfies ToolDef<InputSchema, Output>)
