import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'path'

const DEFAULT_WORKSPACE_DIR = '.inftest-workspace'

const WORKSPACE_SUBDIRS = [
  'input',
  'case_generation',
  'data_mock',
  'device_scheduling',
  'execution/results',
  'execution/logs',
  'analysis',
] as const

export type InitWorkspaceResult = {
  task_id: string
  workspace: string
  directories: string[]
}

export function validateTaskId(taskId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(taskId)) {
    throw new Error(
      'task_id may only contain letters, numbers, dot, underscore, and dash',
    )
  }
}

export function getDefaultInfTestWorkspaceRoot(cwd = process.cwd()): string {
  const configured = process.env.INFTEST_WORKSPACE_ROOT
  return configured ? resolve(configured) : resolve(cwd, DEFAULT_WORKSPACE_DIR)
}

function assertInside(root: string, candidate: string): void {
  const rel = relative(root, candidate)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return
  throw new Error(`Path escapes workspace root: ${candidate}`)
}

export class WorkspaceManager {
  readonly root: string

  constructor(root = getDefaultInfTestWorkspaceRoot()) {
    this.root = resolve(root)
  }

  getTaskWorkspace(taskId: string): string {
    validateTaskId(taskId)
    const workspace = resolve(this.root, taskId)
    assertInside(this.root, workspace)
    return workspace
  }

  async init(taskId: string): Promise<InitWorkspaceResult> {
    const workspace = this.getTaskWorkspace(taskId)
    const directories = WORKSPACE_SUBDIRS.map(dir => join(workspace, dir))
    await mkdir(workspace, { recursive: true })
    await Promise.all(directories.map(dir => mkdir(dir, { recursive: true })))
    return {
      task_id: taskId,
      workspace,
      directories,
    }
  }

  resolveArtifactPath(workspace: string, artifactPath: string): string {
    const workspaceRoot = resolve(workspace)
    assertInside(this.root, workspaceRoot)
    if (isAbsolute(artifactPath)) {
      const resolved = resolve(artifactPath)
      assertInside(workspaceRoot, resolved)
      return resolved
    }
    const resolved = resolve(workspaceRoot, artifactPath)
    assertInside(workspaceRoot, resolved)
    return resolved
  }

  async writeJson(
    workspace: string,
    artifactPath: string,
    data: unknown,
  ): Promise<string> {
    const target = this.resolveArtifactPath(workspace, artifactPath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    return target
  }

  async writeText(
    workspace: string,
    artifactPath: string,
    content: string,
  ): Promise<string> {
    const target = this.resolveArtifactPath(workspace, artifactPath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
    return target
  }

  async readText(workspace: string, artifactPath: string): Promise<string> {
    const target = this.resolveArtifactPath(workspace, artifactPath)
    return readFile(target, 'utf8')
  }
}
