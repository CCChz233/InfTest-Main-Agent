import { afterEach, expect, test } from 'bun:test'
import {
  buildUpdateTaskStatusPayload,
  mapPartialStopProxyStatus,
} from '../adapters/updateTaskStatusPayload.js'
import type { TaskUpdate } from '../schemas/update.js'

const previousEnumFormat = process.env.INFTEST_PROXY_STATUS_ENUM_FORMAT

afterEach(() => {
  if (previousEnumFormat === undefined) {
    delete process.env.INFTEST_PROXY_STATUS_ENUM_FORMAT
  } else {
    process.env.INFTEST_PROXY_STATUS_ENUM_FORMAT = previousEnumFormat
  }
})

function baseUpdate(overrides: Partial<TaskUpdate> = {}): TaskUpdate {
  return {
    event_id: 'evt-1',
    task_id: 'task-123',
    stage_operations: [],
    case_node_operations: [],
    case_detail_operations: [],
    ...overrides,
  }
}

test('builds strict UpdateTaskStatusRequest with int enums (colleague contract)', () => {
  process.env.INFTEST_PROXY_STATUS_ENUM_FORMAT = 'int'
  const payload = buildUpdateTaskStatusPayload(
    baseUpdate({
      agent_name: 'test_generation',
      task_status: 'RUNNING',
      total_tokens: 42,
      output_json: '{"k":"v"}',
      step_log: 'log line',
      start_time: '2026-05-29T08:00:00.000Z',
      end_time: '2026-05-29T08:00:05.000Z',
    }),
  )
  expect(payload.task_id).toBe('task-123')
  expect(payload.agent_name).toBe(1)
  expect(payload.agent_status).toBe(1)
  expect(payload.total_tokens).toBe(42)
  expect(payload.output_json).toBe('{"k":"v"}')
  expect(payload.step_log).toBe('log line')
  expect(payload.start_time).toBe('2026-05-29T08:00:00Z')
  expect(payload.end_time).toBe('2026-05-29T08:00:05Z')
  expect(Object.keys(payload).sort()).toEqual(
    [
      'agent_name',
      'agent_status',
      'end_time',
      'output_json',
      'start_time',
      'step_log',
      'task_id',
      'total_tokens',
    ].sort(),
  )
})

test('FAILED and SUCCESS map to distinct numeric values (2 vs 3)', () => {
  process.env.INFTEST_PROXY_STATUS_ENUM_FORMAT = 'int'
  const failed = buildUpdateTaskStatusPayload(
    baseUpdate({ agent_name: 'test_executor', task_status: 'FAILED' }),
  )
  const success = buildUpdateTaskStatusPayload(
    baseUpdate({ agent_name: 'test_executor', task_status: 'SUCCESS' }),
  )
  expect(failed.agent_status).toBe(2)
  expect(success.agent_status).toBe(3)
})

test('derives agent_name from current_stage when not explicit', () => {
  process.env.INFTEST_PROXY_STATUS_ENUM_FORMAT = 'int'
  const payload = buildUpdateTaskStatusPayload(
    baseUpdate({ current_stage: 'REFLECTING', task_status: 'FAILED' }),
  )
  expect(payload.agent_name).toBe(5)
  expect(payload.agent_status).toBe(2)
})

test('rejects planner-owned stages without AgentName mapping', () => {
  process.env.INFTEST_PROXY_STATUS_ENUM_FORMAT = 'int'
  expect(() =>
    buildUpdateTaskStatusPayload(
      baseUpdate({ current_stage: 'COMPLETED', task_status: 'SUCCESS' }),
    ),
  ).toThrow(/agent_name/)
})

test('falls back step_log to message and never emits internal-only fields', () => {
  process.env.INFTEST_PROXY_STATUS_ENUM_FORMAT = 'int'
  const payload = buildUpdateTaskStatusPayload(
    baseUpdate({
      agent_name: 'test_executor',
      task_status: 'RUNNING',
      message: 'fallback log',
    }),
  )
  expect(payload.step_log).toBe('fallback log')
  expect('event_id' in payload).toBe(false)
})

test('always includes end_time (uses start_time when RUNNING without end_time)', () => {
  process.env.INFTEST_PROXY_STATUS_ENUM_FORMAT = 'int'
  const payload = buildUpdateTaskStatusPayload(
    baseUpdate({
      agent_name: 'test_generation',
      task_status: 'RUNNING',
      start_time: '2026-05-29T08:00:00.000Z',
    }),
  )
  expect(payload.end_time).toBe('2026-05-29T08:00:00Z')
})

test('proxy_status CHECK maps to numeric 1 for case-ready partial stop', () => {
  process.env.INFTEST_PROXY_STATUS_ENUM_FORMAT = 'int'
  const payload = buildUpdateTaskStatusPayload(
    baseUpdate({
      agent_name: 'test_generation',
      task_status: 'PAUSED',
      proxy_status: 'CHECK',
      step_log: 'awaiting case-publish',
    }),
  )
  expect(payload.agent_status).toBe(1)
  expect(payload.agent_name).toBe(1)
})

test('proxy_status PAUSED maps to numeric 4 for execution partial stop', () => {
  process.env.INFTEST_PROXY_STATUS_ENUM_FORMAT = 'int'
  const payload = buildUpdateTaskStatusPayload(
    baseUpdate({
      current_stage: 'EXECUTING',
      task_status: 'PAUSED',
      proxy_status: 'PAUSED',
    }),
  )
  expect(payload.agent_status).toBe(4)
  expect(payload.agent_name).toBe(4)
})

test('mapPartialStopProxyStatus uses CHECK after DATA_GEN and PAUSED after EXECUTING', () => {
  expect(mapPartialStopProxyStatus('DATA_GEN')).toBe('CHECK')
  expect(mapPartialStopProxyStatus('EXECUTING')).toBe('PAUSED')
})
