import { appendFile, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { StageTransitionRecord, TaskSession } from './schemas/session.js'
import type { InfTestStage, TaskStatus } from './schemas/task.js'
import type { InfTestSkill, SkillResult } from './skills/types.js'

export type InfTestHookEvent = {
  task_id: string
  event_id: string
  event_type: string
  stage: InfTestStage | null
  status: TaskStatus
  timestamp: string
  payload: Record<string, unknown>
}

export type TaskFinishPayload = {
  status: Extract<TaskStatus, 'SUCCESS' | 'FAILED' | 'TERMINATED'>
  message: string
  artifacts: Record<string, string>
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  if (typeof error === 'string') return error
  return JSON.stringify(error)
}

export class HookManager {
  private sequence = 0
  readonly experimentDir: string

  constructor(private readonly workspace: string) {
    this.experimentDir = join(workspace, 'experiment')
  }

  async onTaskStart(session: TaskSession): Promise<void> {
    await this.writeHookEvent(session, 'onTaskStart', {
      runner: session.runner,
      workspace: session.workspace,
    })
  }

  async onEnterStage(session: TaskSession): Promise<void> {
    await this.writeHookEvent(session, 'onEnterStage', {
      current_stage: session.current_stage,
      previous_stage: session.previous_stage,
    })
  }

  async beforeSkillCall(
    session: TaskSession,
    skill: InfTestSkill,
  ): Promise<void> {
    await this.writeHookEvent(session, 'beforeSkillCall', {
      skill: skill.name,
      skill_stage: skill.stage,
    })
    await this.appendSkillInvocation({
      task_id: session.task_id,
      event: 'beforeSkillCall',
      skill: skill.name,
      stage: skill.stage,
      status: session.status,
      timestamp: new Date().toISOString(),
    })
  }

  async afterSkillCall(
    session: TaskSession,
    skill: InfTestSkill,
    result: SkillResult,
    durationMs: number,
  ): Promise<void> {
    await this.writeHookEvent(session, 'afterSkillCall', {
      skill: skill.name,
      skill_stage: skill.stage,
      result_status: result.status,
      duration_ms: durationMs,
      artifacts: result.artifacts,
      message: result.message,
      error: result.error,
    })
    await this.appendSkillInvocation({
      task_id: session.task_id,
      event: 'afterSkillCall',
      skill: skill.name,
      stage: skill.stage,
      status: session.status,
      result_status: result.status,
      duration_ms: durationMs,
      artifacts: result.artifacts,
      message: result.message,
      error: result.error,
      timestamp: new Date().toISOString(),
    })
  }

  async onSkillError(
    session: TaskSession,
    skill: InfTestSkill,
    error: unknown,
  ): Promise<void> {
    const message = errorToMessage(error)
    await this.writeHookEvent(session, 'onSkillError', {
      skill: skill.name,
      skill_stage: skill.stage,
      error: message,
    })
    await this.appendSkillInvocation({
      task_id: session.task_id,
      event: 'onSkillError',
      skill: skill.name,
      stage: skill.stage,
      status: session.status,
      error: message,
      timestamp: new Date().toISOString(),
    })
  }

  async onTaskFinish(
    session: TaskSession,
    payload: TaskFinishPayload,
  ): Promise<void> {
    await this.writeHookEvent(session, 'onTaskFinish', payload)
    await this.writeSummary(session, payload)
  }

  async recordStateTransition(
    transition: StageTransitionRecord,
  ): Promise<void> {
    await this.appendJsonl('state_transitions.jsonl', transition)
  }

  private async writeHookEvent(
    session: TaskSession,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const event: InfTestHookEvent = {
      task_id: session.task_id,
      event_id: `${session.task_id}:${eventType}:${++this.sequence}`,
      event_type: eventType,
      stage: session.current_stage,
      status: session.status,
      timestamp: new Date().toISOString(),
      payload,
    }
    await this.appendJsonl('hooks.jsonl', event)
  }

  private async appendSkillInvocation(
    event: Record<string, unknown>,
  ): Promise<void> {
    await this.appendJsonl('skill_invocations.jsonl', event)
  }

  private async appendJsonl(fileName: string, payload: unknown): Promise<void> {
    await mkdir(this.experimentDir, { recursive: true })
    await appendFile(
      join(this.experimentDir, fileName),
      `${JSON.stringify(payload)}\n`,
      'utf8',
    )
  }

  private async writeSummary(
    session: TaskSession,
    payload: TaskFinishPayload,
  ): Promise<void> {
    await mkdir(this.experimentDir, { recursive: true })
    const transitions = session.stage_history
      .map(
        item =>
          `- ${item.timestamp}: ${item.from_status}/${item.from_stage ?? 'null'} -> ${item.to_status}/${item.to_stage ?? 'null'} (${item.trigger})`,
      )
      .join('\n')
    const artifacts = Object.entries(payload.artifacts)
      .map(([key, path]) => `- ${key}: ${path}`)
      .join('\n')
    const content = [
      '# InfTest Stateful Runner Summary',
      '',
      `- task_id: ${session.task_id}`,
      `- status: ${payload.status}`,
      `- current_stage: ${session.current_stage ?? 'null'}`,
      `- message: ${payload.message}`,
      '',
      '## State Transitions',
      transitions || '- none',
      '',
      '## Artifacts',
      artifacts || '- none',
      '',
    ].join('\n')
    await writeFile(join(this.experimentDir, 'summary.md'), content, 'utf8')
  }
}
