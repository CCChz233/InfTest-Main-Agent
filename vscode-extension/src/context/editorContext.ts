import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import type { EditorContext } from '../types'

export function collectEditorContext(workspaceRoot: string): EditorContext {
  const ctx: EditorContext = {}
  const editor = vscode.window.activeTextEditor

  if (editor) {
    const doc = editor.document
    ctx.currentFile = {
      path: path.relative(workspaceRoot, doc.fileName),
      content: doc.getText(),
      language: doc.languageId,
    }

    const selection = editor.selection
    if (!selection.isEmpty) {
      ctx.selectedCode = {
        code: doc.getText(selection),
        language: doc.languageId,
        startLine: selection.start.line + 1,
        endLine: selection.end.line + 1,
      }
    }
  }

  ctx.workspaceStructure = buildFileTree(workspaceRoot, 3)
  return ctx
}

function buildFileTree(dir: string, maxDepth: number, depth = 0, prefix = ''): string {
  if (depth > maxDepth) return ''
  const IGNORE = new Set(['.git', 'node_modules', 'out', '.DS_Store', 'vendor'])
  let result = ''
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return ''
  }
  entries = entries.filter(e => !IGNORE.has(e.name))
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const isLast = i === entries.length - 1
    const connector = isLast ? '└── ' : '├── '
    result += prefix + connector + entry.name + '\n'
    if (entry.isDirectory()) {
      const childPrefix = prefix + (isLast ? '    ' : '│   ')
      result += buildFileTree(path.join(dir, entry.name), maxDepth, depth + 1, childPrefix)
    }
    if (result.length > 8000) {
      result += prefix + '    ...\n'
      break
    }
  }
  return result
}
