import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import type { ServerMessage } from '../types'

export class ChatPanel {
  private panel: vscode.WebviewView
  private context: vscode.ExtensionContext
  private port: number
  private workspaceRoot: string

  constructor(
    panel: vscode.WebviewView,
    context: vscode.ExtensionContext,
    port: number,
    workspaceRoot: string
  ) {
    this.panel = panel
    this.context = context
    this.port = port
    this.workspaceRoot = workspaceRoot
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, 'webview')),
        vscode.Uri.file(path.join(context.extensionPath, 'vendor')),
      ],
    }
    this.panel.webview.html = this.getHtml()
    this.panel.webview.onDidReceiveMessage(msg => this.handleWebviewMessage(msg))
  }

  private handleWebviewMessage(msg: { type: string }) {
    if (msg.type === 'ready') {
      const history = this.context.globalState.get<object[]>('claudeChat.history', [])
      this.panel.webview.postMessage({ type: 'init', port: this.port, history })
    }
  }

  postServerMessage(msg: ServerMessage) {
    this.panel.webview.postMessage(msg)
  }

  appendHistory(msg: object) {
    const maxMessages = vscode.workspace
      .getConfiguration('claudeCode')
      .get<number>('maxHistoryMessages', 100)
    const history = this.context.globalState.get<object[]>('claudeChat.history', [])
    history.push(msg)
    if (history.length > maxMessages) history.splice(0, history.length - maxMessages)
    this.context.globalState.update('claudeChat.history', history)
  }

  clearHistory() {
    this.context.globalState.update('claudeChat.history', [])
  }

  private getHtml(): string {
    const webview = this.panel.webview
    const extPath = this.context.extensionPath

    const toUri = (rel: string) =>
      webview.asWebviewUri(vscode.Uri.file(path.join(extPath, rel))).toString()

    const nonce = randomNonce()
    const htmlPath = path.join(extPath, 'webview', 'index.html')
    let html = fs.readFileSync(htmlPath, 'utf8')

    html = html
      .replace(/\{\{nonce\}\}/g, nonce)
      .replace(/\{\{markedUri\}\}/g, toUri('vendor/marked.min.js'))
      .replace(/\{\{highlightJsUri\}\}/g, toUri('vendor/highlight.min.js'))
      .replace(/\{\{highlightCssUri\}\}/g, toUri('vendor/highlight.min.css'))
      .replace(/\{\{chatJsUri\}\}/g, toUri('webview/chat.js'))
      .replace(/\{\{styleCssUri\}\}/g, toUri('webview/style.css'))

    return html
  }
}

function randomNonce(): string {
  return [...Array(32)].map(() => Math.random().toString(36)[2]).join('')
}
