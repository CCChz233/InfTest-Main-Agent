import * as http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { ClaudeAdapter } from './claudeAdapter'
import type { ClientMessage, EditorContext, ServerMessage } from '../types'

export class WsServer {
  private httpServer: http.Server
  private wss: WebSocketServer
  private adapter: ClaudeAdapter
  private messageCallback?: (msg: ServerMessage) => void
  private userMessageCallback?: (content: string) => EditorContext
  private assistantMessageCallback?: (content: string) => void

  constructor(port: number, workspaceRoot: string, autoApproveTools: string[]) {
    this.adapter = new ClaudeAdapter(workspaceRoot, autoApproveTools)
    this.httpServer = http.createServer()
    this.wss = new WebSocketServer({ server: this.httpServer })

    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws)
    })

    this.httpServer.listen(port, '127.0.0.1')
  }

  private handleConnection(ws: WebSocket) {
    ws.on('message', async (raw: Buffer) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }

      if (msg.type === 'message') {
        const ctx = this.userMessageCallback?.(msg.content) ?? msg.context
        this.adapter.send(msg.content, ctx, (serverMsg: ServerMessage) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(serverMsg))
          }
          this.messageCallback?.(serverMsg)
        })
      } else if (msg.type === 'tool_approval') {
        this.adapter.resolveToolApproval(msg.id, msg.approved)
      } else if (msg.type === 'clear_history') {
        this.adapter.clearSession()
      }
    })

    ws.on('close', () => {
      this.adapter.abort()
    })
  }

  onMessage(cb: (msg: ServerMessage) => void) { this.messageCallback = cb }
  onUserMessage(cb: (content: string) => EditorContext) { this.userMessageCallback = cb }
  onAssistantMessage(cb: (content: string) => void) { this.assistantMessageCallback = cb }

  dispose() {
    this.adapter.abort()
    this.wss.close()
    this.httpServer.close()
  }
}
