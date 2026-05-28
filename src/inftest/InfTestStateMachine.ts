import type { StageTransitionRecord, TaskSession } from './schemas/session.js'
import {
  INFTEST_STAGES,
  type InfTestStage,
  type TaskStatus,
} from './schemas/task.js'

export type InfTestStateTransitionTrigger =
  | 'START'
  | 'ADVANCE'
  | 'COMPLETE'
  | 'FAIL'
  | 'PAUSE'
  | 'CONTINUE'
  | 'TERMINATE'
  | 'RESTART'

export class InvalidInfTestStateTransitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidInfTestStateTransitionError'
  }
}

const TERMINAL_STATUSES = new Set<TaskStatus>([
  'SUCCESS',
  'FAILED',
  'TERMINATED',
])

function nextStage(stage: InfTestStage): InfTestStage | null {
  const index = INFTEST_STAGES.indexOf(stage)
  if (index === -1) return null
  return INFTEST_STAGES[index + 1] ?? null
}

function assertTransitionAllowed(
  session: TaskSession,
  toStatus: TaskStatus,
  toStage: InfTestStage | null,
  trigger: InfTestStateTransitionTrigger,
): void {
  const fromStatus = session.status
  const fromStage = session.current_stage

  switch (trigger) {
    case 'START':
      if (
        fromStatus !== 'RUNNING' ||
        fromStage !== null ||
        toStatus !== 'RUNNING' ||
        toStage !== 'PLANNING'
      ) {
        throw new InvalidInfTestStateTransitionError(
          `START must enter PLANNING from RUNNING without current_stage, got ${fromStatus}/${fromStage ?? 'null'} -> ${toStatus}/${toStage ?? 'null'}`,
        )
      }
      return
    case 'ADVANCE': {
      if (
        fromStatus !== 'RUNNING' ||
        toStatus !== 'RUNNING' ||
        fromStage === null
      ) {
        throw new InvalidInfTestStateTransitionError(
          `ADVANCE requires RUNNING with a current stage, got ${fromStatus}/${fromStage ?? 'null'}`,
        )
      }
      const expected = nextStage(fromStage)
      if (expected === null || toStage !== expected) {
        throw new InvalidInfTestStateTransitionError(
          `Illegal stage transition: ${fromStage} -> ${toStage ?? 'null'}, expected ${expected ?? 'none'}`,
        )
      }
      return
    }
    case 'COMPLETE':
      if (fromStatus !== 'RUNNING' || fromStage !== 'COMPLETED') {
        throw new InvalidInfTestStateTransitionError(
          `COMPLETE requires RUNNING/COMPLETED, got ${fromStatus}/${fromStage ?? 'null'}`,
        )
      }
      if (toStatus !== 'SUCCESS' || toStage !== 'COMPLETED') {
        throw new InvalidInfTestStateTransitionError(
          `COMPLETE must finish as SUCCESS/COMPLETED, got ${toStatus}/${toStage ?? 'null'}`,
        )
      }
      return
    case 'FAIL':
      if (TERMINAL_STATUSES.has(fromStatus)) {
        throw new InvalidInfTestStateTransitionError(
          `Cannot fail a terminal task from ${fromStatus}`,
        )
      }
      if (toStatus !== 'FAILED' || toStage !== fromStage) {
        throw new InvalidInfTestStateTransitionError(
          `FAIL must keep the current stage and set FAILED, got ${toStatus}/${toStage ?? 'null'}`,
        )
      }
      return
    case 'PAUSE':
      if (
        fromStatus !== 'RUNNING' ||
        toStatus !== 'PAUSED' ||
        toStage !== fromStage
      ) {
        throw new InvalidInfTestStateTransitionError(
          `PAUSE requires RUNNING and keeps stage, got ${fromStatus}/${fromStage ?? 'null'} -> ${toStatus}/${toStage ?? 'null'}`,
        )
      }
      return
    case 'CONTINUE':
      if (
        fromStatus !== 'PAUSED' ||
        toStatus !== 'RUNNING' ||
        toStage !== fromStage
      ) {
        throw new InvalidInfTestStateTransitionError(
          `CONTINUE requires PAUSED and keeps stage, got ${fromStatus}/${fromStage ?? 'null'} -> ${toStatus}/${toStage ?? 'null'}`,
        )
      }
      return
    case 'TERMINATE':
      if (
        !['RUNNING', 'PAUSED'].includes(fromStatus) ||
        toStatus !== 'TERMINATED' ||
        toStage !== fromStage
      ) {
        throw new InvalidInfTestStateTransitionError(
          `TERMINATE requires RUNNING or PAUSED and keeps stage, got ${fromStatus}/${fromStage ?? 'null'} -> ${toStatus}/${toStage ?? 'null'}`,
        )
      }
      return
    case 'RESTART':
      if (
        !TERMINAL_STATUSES.has(fromStatus) ||
        toStatus !== 'RUNNING' ||
        toStage !== 'PLANNING'
      ) {
        throw new InvalidInfTestStateTransitionError(
          `RESTART requires terminal status and enters RUNNING/PLANNING, got ${fromStatus}/${fromStage ?? 'null'} -> ${toStatus}/${toStage ?? 'null'}`,
        )
      }
      return
  }
}

export class InfTestStateMachine {
  transition(
    session: TaskSession,
    toStatus: TaskStatus,
    toStage: InfTestStage | null,
    trigger: InfTestStateTransitionTrigger,
    message?: string,
  ): TaskSession {
    assertTransitionAllowed(session, toStatus, toStage, trigger)

    const record: StageTransitionRecord = {
      task_id: session.task_id,
      from_stage: session.current_stage,
      to_stage: toStage,
      from_status: session.status,
      to_status: toStatus,
      trigger,
      timestamp: new Date().toISOString(),
      ...(message ? { message } : {}),
    }

    const stageChanged = session.current_stage !== toStage
    return {
      ...session,
      status: toStatus,
      previous_stage: stageChanged
        ? session.current_stage
        : session.previous_stage,
      current_stage: toStage,
      blocking_reason: toStatus === 'FAILED' ? (message ?? null) : null,
      stage_history: [...session.stage_history, record],
    }
  }

  start(session: TaskSession): TaskSession {
    return this.transition(session, 'RUNNING', 'PLANNING', 'START')
  }

  advance(session: TaskSession): TaskSession {
    if (session.current_stage === null) {
      throw new InvalidInfTestStateTransitionError(
        'Cannot advance without current_stage',
      )
    }
    const target = nextStage(session.current_stage)
    if (target === null) {
      throw new InvalidInfTestStateTransitionError(
        `Cannot advance after ${session.current_stage}`,
      )
    }
    return this.transition(session, 'RUNNING', target, 'ADVANCE')
  }

  complete(session: TaskSession): TaskSession {
    return this.transition(session, 'SUCCESS', 'COMPLETED', 'COMPLETE')
  }

  fail(session: TaskSession, message: string): TaskSession {
    return this.transition(
      session,
      'FAILED',
      session.current_stage,
      'FAIL',
      message,
    )
  }

  pause(session: TaskSession): TaskSession {
    return this.transition(session, 'PAUSED', session.current_stage, 'PAUSE')
  }

  continue(session: TaskSession): TaskSession {
    return this.transition(
      session,
      'RUNNING',
      session.current_stage,
      'CONTINUE',
    )
  }

  terminate(session: TaskSession): TaskSession {
    return this.transition(
      session,
      'TERMINATED',
      session.current_stage,
      'TERMINATE',
    )
  }

  restart(session: TaskSession): TaskSession {
    return this.transition(session, 'RUNNING', 'PLANNING', 'RESTART')
  }
}
