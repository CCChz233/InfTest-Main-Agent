export interface EditorContext {
  currentFile?: { path: string; content: string; language: string }
  selectedCode?: { code: string; language: string; startLine: number; endLine: number }
  workspaceStructure?: string
}

// Client → Server
export type ClientMessage =
  | { type: 'message'; content: string; context: EditorContext }
  | { type: 'tool_approval'; id: string; approved: boolean }
  | { type: 'clear_history' }

// Server → Client
export type ServerMessage =
  | { type: 'stream_delta'; content: string }
  | { type: 'stream_end' }
  | { type: 'tool_call'; id: string; name: string; params: object }
  | { type: 'tool_result'; id: string; result: string }
  | { type: 'error'; message: string; retryable: boolean }
  | { type: 'connected' }
  | { type: 'context_update'; context: EditorContext }
