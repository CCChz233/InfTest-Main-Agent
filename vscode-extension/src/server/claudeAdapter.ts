import { spawn, ChildProcess } from 'child_process'
import type { EditorContext, ServerMessage } from '../types'

type SendCallback = (msg: ServerMessage) => void

export class ClaudeAdapter {
  private sessionId: string | null = null
  private currentProcess: ChildProcess | null = null
  private workspaceRoot: string
  private autoApproveTools: string[]

  constructor(workspaceRoot: string, autoApproveTools: string[]) {
    this.workspaceRoot = workspaceRoot
    this.autoApproveTools = autoApproveTools
  }

  send(content: string, context: EditorContext, cb: SendCallback) {
    this.abort()

    const fullContent = this.buildPrompt(content, context)
    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
    ]

    // Resume existing session if we have one, otherwise start fresh
    if (this.sessionId) {
      args.push('--resume', this.sessionId)
    }

    if (this.autoApproveTools.length > 0) {
      args.push('--allowedTools', this.autoApproveTools.join(','))
    }

    const proc = spawn('claude', args, {
      cwd: this.workspaceRoot,
      env: { ...process.env },
    })
    this.currentProcess = proc

    const userMsg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: fullContent },
    })
    proc.stdin.write(userMsg + '\n')
    proc.stdin.end()

    let buffer = ''
    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        this.parseLine(line, cb)
      }
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) cb({ type: 'error', message: text, retryable: true })
    })

    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        cb({ type: 'error', message: `claude exited with code ${code}`, retryable: true })
      }
      cb({ type: 'stream_end' })
      this.currentProcess = null
    })
  }

  private parseLine(line: string, cb: SendCallback) {
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line)
    } catch {
      return
    }

    const type = obj.type as string

    if (type === 'assistant') {
      const msg = obj.message as Record<string, unknown>
      const content = msg?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as Record<string, unknown>
          if (b.type === 'text') {
            cb({ type: 'stream_delta', content: b.text as string })
          } else if (b.type === 'tool_use') {
            const toolId = b.id as string
            const toolName = b.name as string
            const toolParams = b.input as object
            cb({ type: 'tool_call', id: toolId, name: toolName, params: toolParams })
          }
        }
      }
    } else if (type === 'tool_result') {
      const toolId = obj.tool_use_id as string
      const result = JSON.stringify(obj.content ?? '')
      cb({ type: 'tool_result', id: toolId, result })
    } else if (type === 'result') {
      // Capture session_id for multi-turn conversation continuity
      if (obj.session_id) {
        this.sessionId = obj.session_id as string
      }
      if ((obj.subtype as string) === 'error') {
        cb({ type: 'error', message: (obj.error as string) ?? 'Unknown error', retryable: false })
      }
    }
  }

  private buildPrompt(content: string, ctx: EditorContext): string {
    const parts: string[] = [content]
    if (ctx.currentFile) {
      parts.push(`\n\n<current_file path="${ctx.currentFile.path}" language="${ctx.currentFile.language}">\n${ctx.currentFile.content}\n</current_file>`)
    }
    if (ctx.selectedCode) {
      parts.push(`\n\n<selected_code language="${ctx.selectedCode.language}" lines="${ctx.selectedCode.startLine}-${ctx.selectedCode.endLine}">\n${ctx.selectedCode.code}\n</selected_code>`)
    }
    if (ctx.workspaceStructure) {
      parts.push(`\n\n<workspace_structure>\n${ctx.workspaceStructure}\n</workspace_structure>`)
    }
    return parts.join('')
  }

  resolveToolApproval(_id: string, _approved: boolean) {
    // Tool approval is handled by claude CLI's --allowedTools flag
    // This method is kept for future interactive approval support
  }

  clearSession() {
    this.abort()
    this.sessionId = null
  }

  abort() {
    if (this.currentProcess) {
      this.currentProcess.kill()
      this.currentProcess = null
    }
  }
}
