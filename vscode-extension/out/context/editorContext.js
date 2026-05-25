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
exports.collectEditorContext = collectEditorContext;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
function collectEditorContext(workspaceRoot) {
    const ctx = {};
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const doc = editor.document;
        ctx.currentFile = {
            path: path.relative(workspaceRoot, doc.fileName),
            content: doc.getText(),
            language: doc.languageId,
        };
        const selection = editor.selection;
        if (!selection.isEmpty) {
            ctx.selectedCode = {
                code: doc.getText(selection),
                language: doc.languageId,
                startLine: selection.start.line + 1,
                endLine: selection.end.line + 1,
            };
        }
    }
    ctx.workspaceStructure = buildFileTree(workspaceRoot, 3);
    return ctx;
}
function buildFileTree(dir, maxDepth, depth = 0, prefix = '') {
    if (depth > maxDepth)
        return '';
    const IGNORE = new Set(['.git', 'node_modules', 'out', '.DS_Store', 'vendor']);
    let result = '';
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return '';
    }
    entries = entries.filter(e => !IGNORE.has(e.name));
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const isLast = i === entries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        result += prefix + connector + entry.name + '\n';
        if (entry.isDirectory()) {
            const childPrefix = prefix + (isLast ? '    ' : '│   ');
            result += buildFileTree(path.join(dir, entry.name), maxDepth, depth + 1, childPrefix);
        }
        if (result.length > 8000) {
            result += prefix + '    ...\n';
            break;
        }
    }
    return result;
}
