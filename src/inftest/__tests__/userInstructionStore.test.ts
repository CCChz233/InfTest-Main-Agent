import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { afterEach, expect, test } from 'bun:test'
import { getPlanWorkspace } from '../server/planContextArtifacts.js'
import {
  buildExecutionAgentExtraArgs,
  buildReportAgentExtraArgs,
  copyUserInstructionFromPlanToTask,
  loadUserInstructionFromWorkspace,
  persistUserInstruction,
  USER_INSTRUCTION_REL_PATH,
} from '../server/userInstructionStore.js'

const tmpRoot = join(process.cwd(), '.inftest-workspace', 'tmp-tests-user-instruction')
const planId = 'plan-user-instruction-test'
const execId = 'exec-user-instruction-test'

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

test('persist and load user instruction from workspace', () => {
  const execWorkspace = join(tmpRoot, execId)
  persistUserInstruction(execWorkspace, {
    user_instruction: '重点关注登录异常',
    plan_qa_list: [{ question: '补充验证码', answer: '已补充' }],
    plan_id: planId,
    exec_id: execId,
    updated_at: '2026-05-30T08:00:00.000Z',
  })

  const stored = loadUserInstructionFromWorkspace(execWorkspace)
  expect(stored?.user_instruction).toBe('重点关注登录异常')
  expect(stored?.plan_qa_list).toHaveLength(1)
})

test('buildExecutionAgentExtraArgs maps to user_payload text', () => {
  const workspace = join(tmpRoot, 'exec-extra-args')
  persistUserInstruction(workspace, {
    user_instruction: '补充弱网场景',
    updated_at: '2026-05-30T08:00:00.000Z',
  })
  const args = buildExecutionAgentExtraArgs(workspace)
  expect(args.user_payload).toBe('补充弱网场景')
})

test('buildReportAgentExtraArgs maps to user_instruction text', () => {
  const workspace = join(tmpRoot, 'report-extra-args')
  persistUserInstruction(workspace, {
    user_instruction: '重点关注性能问题',
    plan_qa_list: [{ question: '超时', answer: '已加' }],
    updated_at: '2026-05-30T08:00:00.000Z',
  })
  const args = buildReportAgentExtraArgs(workspace)
  expect(args.user_instruction).toContain('重点关注性能问题')
  expect(args.user_instruction).toContain('参考问答')
})

test('copyUserInstructionFromPlanToTask copies newer plan instruction', () => {
  const planWorkspace = getPlanWorkspace(planId, tmpRoot)
  const execWorkspace = join(tmpRoot, execId)
  mkdirSync(join(planWorkspace, 'input'), { recursive: true })
  mkdirSync(join(execWorkspace, 'input'), { recursive: true })

  writeFileSync(
    join(planWorkspace, USER_INSTRUCTION_REL_PATH),
    `${JSON.stringify(
      {
        user_instruction: 'plan level instruction',
        updated_at: '2026-05-30T09:00:00.000Z',
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  copyUserInstructionFromPlanToTask(planId, execWorkspace, execId, tmpRoot)
  const copied = readFileSync(
    join(execWorkspace, USER_INSTRUCTION_REL_PATH),
    'utf8',
  )
  expect(copied).toContain('plan level instruction')
})
