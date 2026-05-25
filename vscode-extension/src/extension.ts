import * as vscode from 'vscode'
import { findAvailablePort } from './server/portFinder'
import { WsServer } from './server/wsServer'
import { ChatPanel } from './panel/chatPanel'
import { collectEditorContext } from './context/editorContext'

let wsServer: WsServer | undefined
let chatPanel: ChatPanel | undefined

export async function activate(context: vscode.ExtensionContext) {
  const claudeAvailable = await checkClaudeCli()
  if (!claudeAvailable) {
    vscode.window.showErrorMessage(
      'Claude Code Chat: `claude` CLI not found. Install it with: npm install -g @anthropic-ai/claude-code'
    )
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
  const autoApproveTools = vscode.workspace
    .getConfiguration('claudeCode')
    .get<string[]>('autoApproveTools', [])

  const port = await findAvailablePort()
  wsServer = new WsServer(port, workspaceRoot, autoApproveTools)

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('claudeChat.panel', {
      resolveWebviewView(webviewView) {
        chatPanel = new ChatPanel(webviewView, context, port, workspaceRoot)

        wsServer!.onMessage((msg) => chatPanel!.postServerMessage(msg))

        wsServer!.onUserMessage((content) => {
          const ctx = collectEditorContext(workspaceRoot)
          chatPanel!.appendHistory({ role: 'user', content, timestamp: Date.now() })
          return ctx
        })

        wsServer!.onAssistantMessage((content) => {
          chatPanel!.appendHistory({ role: 'assistant', content, timestamp: Date.now() })
        })
      },
    })
  )

  // Push context updates to webview when editor/selection changes
  const pushContext = () => {
    if (!chatPanel) return
    const ctx = collectEditorContext(workspaceRoot)
    chatPanel.postServerMessage({ type: 'context_update', context: ctx } as any)
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(pushContext),
    vscode.window.onDidChangeTextEditorSelection(pushContext)
  )
}

export function deactivate() {
  wsServer?.dispose()
}

async function checkClaudeCli(): Promise<boolean> {
  return new Promise((resolve) => {
    const { spawn } = require('child_process')
    const proc = spawn('claude', ['--version'], { stdio: 'ignore' })
    proc.on('error', () => resolve(false))
    proc.on('close', (code: number) => resolve(code === 0))
  })
}
