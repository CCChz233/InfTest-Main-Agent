import { describe, expect, test } from 'bun:test'
import {
  InfTestStateMachine,
  InvalidInfTestStateTransitionError,
} from '../InfTestStateMachine.js'
import { TaskSessionManager } from '../TaskSessionManager.js'

describe('InfTestStateMachine', () => {
  test('advances through the happy path stages', () => {
    const manager = new TaskSessionManager()
    const stateMachine = new InfTestStateMachine()
    let session = stateMachine.start(
      manager.start('task-state-001', 'stateful'),
    )

    expect(session.status).toBe('RUNNING')
    expect(session.current_stage).toBe('PLANNING')

    session = stateMachine.advance(session)
    expect(session.current_stage).toBe('DATA_GEN')
    session = stateMachine.advance(session)
    expect(session.current_stage).toBe('COORDINATE')
    session = stateMachine.advance(session)
    expect(session.current_stage).toBe('EXECUTING')
    session = stateMachine.advance(session)
    expect(session.current_stage).toBe('REFLECTING')
    session = stateMachine.advance(session)
    expect(session.current_stage).toBe('COMPLETED')
    session = stateMachine.complete(session)

    expect(session.status).toBe('SUCCESS')
    expect(session.current_stage).toBe('COMPLETED')
    expect(session.stage_history.map(item => item.trigger)).toEqual([
      'START',
      'ADVANCE',
      'ADVANCE',
      'ADVANCE',
      'ADVANCE',
      'ADVANCE',
      'COMPLETE',
    ])
  })

  test('rejects illegal stage skips and terminal transitions', () => {
    const manager = new TaskSessionManager()
    const stateMachine = new InfTestStateMachine()
    const session = stateMachine.start(
      manager.start('task-state-002', 'stateful'),
    )

    expect(() =>
      stateMachine.transition(session, 'RUNNING', 'EXECUTING', 'ADVANCE'),
    ).toThrow(InvalidInfTestStateTransitionError)

    const completed = stateMachine.complete(
      stateMachine.advance(
        stateMachine.advance(
          stateMachine.advance(
            stateMachine.advance(stateMachine.advance(session)),
          ),
        ),
      ),
    )
    expect(() => stateMachine.advance(completed)).toThrow(
      InvalidInfTestStateTransitionError,
    )
    expect(() => stateMachine.pause(completed)).toThrow(
      InvalidInfTestStateTransitionError,
    )
  })
})
