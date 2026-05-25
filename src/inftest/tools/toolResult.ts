import type { ToolResultBlockParam } from 'src/Tool.js'

export function jsonToolResult(
  content: unknown,
  toolUseID: string,
): ToolResultBlockParam {
  return {
    tool_use_id: toolUseID,
    type: 'tool_result',
    content: JSON.stringify(content, null, 2),
  }
}
