"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const portFinder_1 = require("./server/portFinder");
const wsServer_1 = require("./server/wsServer");
const chatPanel_1 = require("./panel/chatPanel");
const editorContext_1 = require("./context/editorContext");
let wsServer;
let chatPanel;
async function activate(context) {
    const claudeAvailable = await checkClaudeCli();
    if (!claudeAvailable) {
        vscode.window.showErrorMessage('Claude Code Chat: `claude` CLI not found. Install it with: npm install -g @anthropic-ai/claude-code');
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const autoApproveTools = vscode.workspace
        .getConfiguration('claudeCode')
        .get('autoApproveTools', []);
    const port = await (0, portFinder_1.findAvailablePort)();
    wsServer = new wsServer_1.WsServer(port, workspaceRoot, autoApproveTools);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('claudeChat.panel', {
        resolveWebviewView(webviewView) {
            chatPanel = new chatPanel_1.ChatPanel(webviewView, context, port, workspaceRoot);
            wsServer.onMessage((msg) => chatPanel.postServerMessage(msg));
            wsServer.onUserMessage((content) => {
                const ctx = (0, editorContext_1.collectEditorContext)(workspaceRoot);
                chatPanel.appendHistory({ role: 'user', content, timestamp: Date.now() });
                return ctx;
            });
            wsServer.onAssistantMessage((content) => {
                chatPanel.appendHistory({ role: 'assistant', content, timestamp: Date.now() });
            });
        },
    }));
    // Push context updates to webview when editor/selection changes
    const pushContext = () => {
        if (!chatPanel)
            return;
        const ctx = (0, editorContext_1.collectEditorContext)(workspaceRoot);
        chatPanel.postServerMessage({ type: 'context_update', context: ctx });
    };
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(pushContext), vscode.window.onDidChangeTextEditorSelection(pushContext));
}
function deactivate() {
    wsServer?.dispose();
}
async function checkClaudeCli() {
    return new Promise((resolve) => {
        const { spawn } = require('child_process');
        const proc = spawn('claude', ['--version'], { stdio: 'ignore' });
        proc.on('error', () => resolve(false));
        proc.on('close', (code) => resolve(code === 0));
    });
}
