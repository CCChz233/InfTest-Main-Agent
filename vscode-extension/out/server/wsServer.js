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
exports.WsServer = void 0;
const http = __importStar(require("http"));
const ws_1 = require("ws");
const claudeAdapter_1 = require("./claudeAdapter");
class WsServer {
    constructor(port, workspaceRoot, autoApproveTools) {
        this.adapter = new claudeAdapter_1.ClaudeAdapter(workspaceRoot, autoApproveTools);
        this.httpServer = http.createServer();
        this.wss = new ws_1.WebSocketServer({ server: this.httpServer });
        this.wss.on('connection', (ws) => {
            this.handleConnection(ws);
        });
        this.httpServer.listen(port, '127.0.0.1');
    }
    handleConnection(ws) {
        ws.on('message', async (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            }
            catch {
                return;
            }
            if (msg.type === 'message') {
                const ctx = this.userMessageCallback?.(msg.content) ?? msg.context;
                this.adapter.send(msg.content, ctx, (serverMsg) => {
                    if (ws.readyState === ws_1.WebSocket.OPEN) {
                        ws.send(JSON.stringify(serverMsg));
                    }
                    this.messageCallback?.(serverMsg);
                });
            }
            else if (msg.type === 'tool_approval') {
                this.adapter.resolveToolApproval(msg.id, msg.approved);
            }
            else if (msg.type === 'clear_history') {
                this.adapter.clearSession();
            }
        });
        ws.on('close', () => {
            this.adapter.abort();
        });
    }
    onMessage(cb) { this.messageCallback = cb; }
    onUserMessage(cb) { this.userMessageCallback = cb; }
    onAssistantMessage(cb) { this.assistantMessageCallback = cb; }
    dispose() {
        this.adapter.abort();
        this.wss.close();
        this.httpServer.close();
    }
}
exports.WsServer = WsServer;
