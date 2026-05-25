"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeAdapter = void 0;
const child_process_1 = require("child_process");
class ClaudeAdapter {
    constructor(workspaceRoot, autoApproveTools) {
        this.sessionId = null;
        this.currentProcess = null;
        this.workspaceRoot = workspaceRoot;
        this.autoApproveTools = autoApproveTools;
    }
    send(content, context, cb) {
        this.abort();
        const fullContent = this.buildPrompt(content, context);
        const args = [
            '--print',
            '--output-format', 'stream-json',
            '--input-format', 'stream-json',
            '--verbose',
        ];
        // Resume existing session if we have one, otherwise start fresh
        if (this.sessionId) {
            args.push('--resume', this.sessionId);
        }
        if (this.autoApproveTools.length > 0) {
            args.push('--allowedTools', this.autoApproveTools.join(','));
        }
        const proc = (0, child_process_1.spawn)('claude', args, {
            cwd: this.workspaceRoot,
            env: { ...process.env },
        });
        this.currentProcess = proc;
        const userMsg = JSON.stringify({
            type: 'user',
            message: { role: 'user', content: fullContent },
        });
        proc.stdin.write(userMsg + '\n');
        proc.stdin.end();
        let buffer = '';
        proc.stdout.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.trim())
                    continue;
                this.parseLine(line, cb);
            }
        });
        proc.stderr.on('data', (chunk) => {
            const text = chunk.toString().trim();
            if (text)
                cb({ type: 'error', message: text, retryable: true });
        });
        proc.on('close', (code) => {
            if (code !== 0 && code !== null) {
                cb({ type: 'error', message: `claude exited with code ${code}`, retryable: true });
            }
            cb({ type: 'stream_end' });
            this.currentProcess = null;
        });
    }
    parseLine(line, cb) {
        let obj;
        try {
            obj = JSON.parse(line);
        }
        catch {
            return;
        }
        const type = obj.type;
        if (type === 'assistant') {
            const msg = obj.message;
            const content = msg?.content;
            if (Array.isArray(content)) {
                for (const block of content) {
                    const b = block;
                    if (b.type === 'text') {
                        cb({ type: 'stream_delta', content: b.text });
                    }
                    else if (b.type === 'tool_use') {
                        const toolId = b.id;
                        const toolName = b.name;
                        const toolParams = b.input;
                        cb({ type: 'tool_call', id: toolId, name: toolName, params: toolParams });
                    }
                }
            }
        }
        else if (type === 'tool_result') {
            const toolId = obj.tool_use_id;
            const result = JSON.stringify(obj.content ?? '');
            cb({ type: 'tool_result', id: toolId, result });
        }
        else if (type === 'result') {
            // Capture session_id for multi-turn conversation continuity
            if (obj.session_id) {
                this.sessionId = obj.session_id;
            }
            if (obj.subtype === 'error') {
                cb({ type: 'error', message: obj.error ?? 'Unknown error', retryable: false });
            }
        }
    }
    buildPrompt(content, ctx) {
        const parts = [content];
        if (ctx.currentFile) {
            parts.push(`\n\n<current_file path="${ctx.currentFile.path}" language="${ctx.currentFile.language}">\n${ctx.currentFile.content}\n</current_file>`);
        }
        if (ctx.selectedCode) {
            parts.push(`\n\n<selected_code language="${ctx.selectedCode.language}" lines="${ctx.selectedCode.startLine}-${ctx.selectedCode.endLine}">\n${ctx.selectedCode.code}\n</selected_code>`);
        }
        if (ctx.workspaceStructure) {
            parts.push(`\n\n<workspace_structure>\n${ctx.workspaceStructure}\n</workspace_structure>`);
        }
        return parts.join('');
    }
    resolveToolApproval(_id, _approved) {
        // Tool approval is handled by claude CLI's --allowedTools flag
        // This method is kept for future interactive approval support
    }
    clearSession() {
        this.abort();
        this.sessionId = null;
    }
    abort() {
        if (this.currentProcess) {
            this.currentProcess.kill();
            this.currentProcess = null;
        }
    }
}
exports.ClaudeAdapter = ClaudeAdapter;
