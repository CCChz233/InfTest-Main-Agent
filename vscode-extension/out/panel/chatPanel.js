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
exports.ChatPanel = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class ChatPanel {
    constructor(panel, context, port, workspaceRoot) {
        this.panel = panel;
        this.context = context;
        this.port = port;
        this.workspaceRoot = workspaceRoot;
        this.panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(context.extensionPath, 'webview')),
                vscode.Uri.file(path.join(context.extensionPath, 'vendor')),
            ],
        };
        this.panel.webview.html = this.getHtml();
        this.panel.webview.onDidReceiveMessage(msg => this.handleWebviewMessage(msg));
    }
    handleWebviewMessage(msg) {
        if (msg.type === 'ready') {
            const history = this.context.globalState.get('claudeChat.history', []);
            this.panel.webview.postMessage({ type: 'init', port: this.port, history });
        }
    }
    postServerMessage(msg) {
        this.panel.webview.postMessage(msg);
    }
    appendHistory(msg) {
        const maxMessages = vscode.workspace
            .getConfiguration('claudeCode')
            .get('maxHistoryMessages', 100);
        const history = this.context.globalState.get('claudeChat.history', []);
        history.push(msg);
        if (history.length > maxMessages)
            history.splice(0, history.length - maxMessages);
        this.context.globalState.update('claudeChat.history', history);
    }
    clearHistory() {
        this.context.globalState.update('claudeChat.history', []);
    }
    getHtml() {
        const webview = this.panel.webview;
        const extPath = this.context.extensionPath;
        const toUri = (rel) => webview.asWebviewUri(vscode.Uri.file(path.join(extPath, rel))).toString();
        const nonce = randomNonce();
        const htmlPath = path.join(extPath, 'webview', 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');
        html = html
            .replace(/\{\{nonce\}\}/g, nonce)
            .replace(/\{\{markedUri\}\}/g, toUri('vendor/marked.min.js'))
            .replace(/\{\{highlightJsUri\}\}/g, toUri('vendor/highlight.min.js'))
            .replace(/\{\{highlightCssUri\}\}/g, toUri('vendor/highlight.min.css'))
            .replace(/\{\{chatJsUri\}\}/g, toUri('webview/chat.js'))
            .replace(/\{\{styleCssUri\}\}/g, toUri('webview/style.css'));
        return html;
    }
}
exports.ChatPanel = ChatPanel;
function randomNonce() {
    return [...Array(32)].map(() => Math.random().toString(36)[2]).join('');
}
