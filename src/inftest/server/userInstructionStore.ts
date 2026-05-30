import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { WorkspaceManager } from '../adapters/WorkspaceManager.js'
import {
  getPlanWorkspace,
  parsePlanQaList,
  type PlanQaEntry,
} from './planContextArtifacts.js'

export const USER_INSTRUCTION_REL_PATH = 'input/user_instruction.json'

export type StoredUserInstruction = {
  user_instruction: string
  plan_qa_list?: PlanQaEntry[]
  plan_id?: string | null
  exec_id?: string | null
  updated_at: string
}

function stringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function formatUserInstructionForExecutionAgent(
  stored: StoredUserInstruction,
): string {
  return formatUserInstructionText(stored)
}

export function formatUserInstructionForReportAgent(
  stored: StoredUserInstruction,
): string {
  const parts = [stored.user_instruction.trim()]
  if (stored.plan_qa_list?.length) {
    for (const qa of stored.plan_qa_list) {
      if (qa.question.trim() || qa.answer.trim()) {
        parts.push(`参考问答 - 问: ${qa.question.trim()} 答: ${qa.answer.trim()}`)
      }
    }
  }
  return parts.filter(Boolean).join('\n')
}

function formatUserInstructionText(stored: StoredUserInstruction): string {
  const parts = [stored.user_instruction.trim()]
  if (stored.plan_qa_list?.length) {
    for (const qa of stored.plan_qa_list) {
      if (qa.question.trim() || qa.answer.trim()) {
        parts.push(`Q: ${qa.question.trim()}\nA: ${qa.answer.trim()}`)
      }
    }
  }
  return parts.filter(Boolean).join('\n\n')
}

export function loadUserInstructionFromWorkspace(
  workspace: string,
): StoredUserInstruction | null {
  const path = join(workspace, USER_INSTRUCTION_REL_PATH)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    const userInstruction = stringField(record, 'user_instruction')
    if (!userInstruction) return null
    const qaList = parsePlanQaList(record)
    return {
      user_instruction: userInstruction,
      plan_qa_list: qaList.length > 0 ? qaList : undefined,
      plan_id: stringField(record, 'plan_id'),
      exec_id: stringField(record, 'exec_id'),
      updated_at: stringField(record, 'updated_at') ?? new Date(0).toISOString(),
    }
  } catch {
    return null
  }
}

export function persistUserInstruction(
  workspace: string,
  input: StoredUserInstruction,
): string {
  mkdirSync(join(workspace, 'input'), { recursive: true })
  const path = join(workspace, USER_INSTRUCTION_REL_PATH)
  writeFileSync(path, `${JSON.stringify(input, null, 2)}\n`, 'utf8')
  return path
}

export function persistUserInstructionFromPayload(
  record: Record<string, unknown>,
): string[] {
  const userInstruction = stringField(record, 'user_instruction')
  if (!userInstruction) return []

  const planId = stringField(record, 'plan_id')
  const execId =
    stringField(record, 'exec_id') ?? stringField(record, 'task_id')
  const qaList = parsePlanQaList(record)
  const stored: StoredUserInstruction = {
    user_instruction: userInstruction,
    plan_qa_list: qaList.length > 0 ? qaList : undefined,
    plan_id: planId,
    exec_id: execId,
    updated_at: new Date().toISOString(),
  }

  const written: string[] = []
  if (planId) {
    written.push(persistUserInstruction(getPlanWorkspace(planId), stored))
  }
  if (execId) {
    const workspace = new WorkspaceManager().getTaskWorkspace(execId)
    written.push(persistUserInstruction(workspace, stored))
  }
  return written
}

export function copyUserInstructionFromPlanToTask(
  planId: string,
  taskWorkspace: string,
  execId: string,
  cwd = process.cwd(),
): void {
  const source = loadUserInstructionFromWorkspace(getPlanWorkspace(planId, cwd))
  if (!source) return
  const existing = loadUserInstructionFromWorkspace(taskWorkspace)
  if (existing && existing.updated_at >= source.updated_at) return
  persistUserInstruction(taskWorkspace, {
    ...source,
    plan_id: planId,
    exec_id: execId,
    updated_at: source.updated_at,
  })
}

export function buildExecutionAgentExtraArgs(
  workspace: string,
): Record<string, string> {
  const stored = loadUserInstructionFromWorkspace(workspace)
  if (!stored) return {}
  const userPayload = formatUserInstructionForExecutionAgent(stored)
  if (!userPayload) return {}
  return { user_payload: userPayload }
}

export function buildReportAgentExtraArgs(
  workspace: string,
): Record<string, string> {
  const stored = loadUserInstructionFromWorkspace(workspace)
  if (!stored) return {}
  const userInstruction = formatUserInstructionForReportAgent(stored)
  if (!userInstruction) return {}
  return { user_instruction: userInstruction }
}
