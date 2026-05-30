import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { TaskSession } from '../schemas/session.js'
import { resetInfTestConfigCacheForTests } from '../config/loadInfTestConfig.js'
import { StaticCaseGenerationSkill } from '../skills/StaticCaseGenerationSkill.js'

const previousRealCaseGeneration = process.env.INFTEST_REAL_CASE_GENERATION
const previousStrictRealOnly = process.env.INFTEST_REAL_ONLY
const previousTestGenerationCmd = process.env.INFTEST_TEST_GENERATION_AGENT_CMD
const previousInfTestConfig = process.env.INFTEST_CONFIG

afterEach(async () => {
  if (previousRealCaseGeneration === undefined) {
    delete process.env.INFTEST_REAL_CASE_GENERATION
  } else {
    process.env.INFTEST_REAL_CASE_GENERATION = previousRealCaseGeneration
  }
  if (previousStrictRealOnly === undefined) {
    delete process.env.INFTEST_REAL_ONLY
  } else {
    process.env.INFTEST_REAL_ONLY = previousStrictRealOnly
  }
  if (previousTestGenerationCmd === undefined) {
    delete process.env.INFTEST_TEST_GENERATION_AGENT_CMD
  } else {
    process.env.INFTEST_TEST_GENERATION_AGENT_CMD = previousTestGenerationCmd
  }
  if (previousInfTestConfig === undefined) {
    delete process.env.INFTEST_CONFIG
  } else {
    process.env.INFTEST_CONFIG = previousInfTestConfig
  }
  resetInfTestConfigCacheForTests()
})

test('StaticCaseGenerationSkill uses real subagent when enabled', async () => {
  process.env.INFTEST_REAL_CASE_GENERATION = '1'
  const tempRoot = join(process.cwd(), '.inftest-workspace', 'tmp-tests')
  await mkdir(tempRoot, { recursive: true })
  const workspace = await mkdtemp(join(tempRoot, 'inftest-static-case-'))
  await mkdir(join(workspace, 'case_generation'), { recursive: true })
  const testCasesPath = join(workspace, 'case_generation', 'from-real.json')
  await writeFile(
    testCasesPath,
    `${JSON.stringify(
      {
        root: {
          node_id: 'root',
          children: [{ node_id: 'c-1', title: 'real generated case' }],
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  const fakeSubAgent = {
    async invoke(input: {
      output_json: string
    }): Promise<{
      success: boolean
      output?: {
        artifacts: Record<string, string>
        metrics?: { case_count?: number }
      }
      error: string | null
      agent_name: 'test_generation'
      output_json: string
      exit_code: number | null
      stdout_log: string
      stderr_log: string
      duration_ms: number
    }> {
      await writeFile(
        input.output_json,
        `${JSON.stringify(
          {
            success: true,
            agent_name: 'test_generation',
            status: 'SUCCESS',
            task_id: 'task-real-case-001',
            artifacts: { test_cases: testCasesPath },
            metrics: { duration_ms: 1, case_count: 1 },
            error: null,
          },
          null,
          2,
        )}\n`,
        'utf8',
      )
      return {
        success: true,
        output: {
          artifacts: { test_cases: testCasesPath },
          metrics: { case_count: 1 },
        },
        error: null,
        agent_name: 'test_generation',
        output_json: input.output_json,
        exit_code: 0,
        stdout_log: '',
        stderr_log: '',
        duration_ms: 1,
      }
    },
  }

  const skill = new StaticCaseGenerationSkill(
    undefined,
    fakeSubAgent as any,
  )
  const result = await skill.run({
    task_id: 'task-real-case-001',
    workspace,
    session: {} as TaskSession,
  })

  expect(result.status).toBe('SUCCESS')
  expect(result.message).toContain('real')
  expect(result.telemetry?.output_json).toContain('real generated case')
  const copiedCases = await readFile(join(workspace, 'case_generation', 'test_cases.json'), 'utf8')
  expect(copiedCases).toContain('real generated case')
  await rm(workspace, { recursive: true, force: true })
})

test('StaticCaseGenerationSkill recognizes config-based test_generation launch in strict mode', async () => {
  delete process.env.INFTEST_REAL_CASE_GENERATION
  delete process.env.INFTEST_TEST_GENERATION_AGENT_CMD
  process.env.INFTEST_REAL_ONLY = '1'
  const tempRoot = join(process.cwd(), '.inftest-workspace', 'tmp-tests')
  await mkdir(tempRoot, { recursive: true })
  const workspace = await mkdtemp(join(tempRoot, 'inftest-static-case-config-'))
  await mkdir(join(workspace, 'case_generation'), { recursive: true })
  const testCasesPath = join(workspace, 'case_generation', 'from-config-real.json')
  await writeFile(
    testCasesPath,
    `${JSON.stringify(
      {
        root: {
          node_id: 'root',
          children: [{ node_id: 'c-1', title: 'config real generated case' }],
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  const configPath = join(workspace, 'config.json')
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        real_only: true,
        subagents: {
          test_generation: {
            command: 'python3',
            args: ['scripts/real_case_generation.py'],
          },
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  process.env.INFTEST_CONFIG = configPath
  resetInfTestConfigCacheForTests()

  let invokeCount = 0
  const fakeSubAgent = {
    async invoke(input: {
      output_json: string
    }): Promise<{
      success: boolean
      output?: { artifacts: Record<string, string> }
      error: string | null
      agent_name: 'test_generation'
      output_json: string
      exit_code: number | null
      stdout_log: string
      stderr_log: string
      duration_ms: number
    }> {
      invokeCount += 1
      await writeFile(
        input.output_json,
        `${JSON.stringify(
          {
            success: true,
            agent_name: 'test_generation',
            status: 'SUCCESS',
            task_id: 'task-real-case-config-001',
            artifacts: { test_cases: testCasesPath },
            metrics: { duration_ms: 1, case_count: 1 },
            error: null,
          },
          null,
          2,
        )}\n`,
        'utf8',
      )
      return {
        success: true,
        output: { artifacts: { test_cases: testCasesPath } },
        error: null,
        agent_name: 'test_generation',
        output_json: input.output_json,
        exit_code: 0,
        stdout_log: '',
        stderr_log: '',
        duration_ms: 1,
      }
    },
  }

  const skill = new StaticCaseGenerationSkill(
    undefined,
    fakeSubAgent as any,
  )
  const result = await skill.run({
    task_id: 'task-real-case-config-001',
    workspace,
    session: {} as TaskSession,
  })

  expect(result.status).toBe('SUCCESS')
  expect(invokeCount).toBe(1)
  const copiedCases = await readFile(join(workspace, 'case_generation', 'test_cases.json'), 'utf8')
  expect(copiedCases).toContain('config real generated case')
  await rm(workspace, { recursive: true, force: true })
})
