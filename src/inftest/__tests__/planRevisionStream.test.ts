import { expect, test } from 'bun:test'
import {
  isPlanRevisionPayload,
  planRevisionInputFromRecord,
} from '../server/planRevisionStream.js'
import { chunkRevisionText } from '../LlmPlanReviser.js'

test('isPlanRevisionPayload requires plan_id, instruction, and detail or qa', () => {
  expect(
    isPlanRevisionPayload({
      plan_id: 'p1',
      user_instruction: 'add cases',
      plan_detail: { test_objectives: 'x' },
    }),
  ).toBe(true)
  expect(
    isPlanRevisionPayload({
      plan_id: 'p1',
      user_instruction: 'add cases',
      plan_qa_list: [{ question: 'q', answer: 'a' }],
    }),
  ).toBe(true)
  expect(
    isPlanRevisionPayload({
      plan_id: 'p1',
      user_instruction: 'add cases',
    }),
  ).toBe(false)
})

test('planRevisionInputFromRecord parses fields', () => {
  const input = planRevisionInputFromRecord(
    {
      plan_id: 'plan-abc',
      user_instruction: 'revise',
      plan_detail: { test_target: 'login' },
    },
    'req-1',
  )
  expect(input?.plan_id).toBe('plan-abc')
  expect(input?.user_instruction).toBe('revise')
  expect(input?.plan_detail?.test_target).toBe('login')
})

test('chunkRevisionText splits long summary', () => {
  const chunks = chunkRevisionText('abcdefghij', 3)
  expect(chunks).toEqual(['abc', 'def', 'ghi', 'j'])
})
