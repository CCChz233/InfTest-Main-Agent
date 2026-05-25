import { z } from 'zod/v4'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { WorkspaceManager } from '../adapters/WorkspaceManager.js'
import { jsonToolResult } from './toolResult.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    workspace: z.string().min(1),
    path: z.string().min(1),
    content: z.string(),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.strictObject({
    path: z.string(),
    bytes: z.number(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const WriteArtifactTool = buildTool({
  name: 'write_artifact',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Write an artifact into the InfTest workspace'
  },
  async prompt() {
    return 'Write a file artifact into the task workspace. Use relative paths inside the workspace.'
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
  async call({ workspace, path, content }) {
    const written = await new WorkspaceManager().writeText(
      workspace,
      path,
      content,
    )
    return {
      data: {
        path: written,
        bytes: Buffer.byteLength(content, 'utf8'),
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return jsonToolResult(content, toolUseID)
  },
} satisfies ToolDef<InputSchema, Output>)
