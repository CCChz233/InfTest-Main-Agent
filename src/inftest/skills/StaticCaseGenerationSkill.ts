import { access, copyFile, readFile } from 'fs/promises'
import { join } from 'path'
import {
  buildSubAgentStepLog,
  SubAgentAdapter,
} from '../adapters/SubAgentAdapter.js'
import { WorkspaceManager } from '../adapters/WorkspaceManager.js'
import { getInfTestConfig } from '../config/loadInfTestConfig.js'
import { logEvent } from '../observability/logger.js'
import {
  buildCaseGenExtraArgs,
  loadPlanConfig,
} from '../server/planContextArtifacts.js'
import { ensureDocFormatTestCasesFile } from '../server/casePublishArtifacts.js'
import {
  buildManualCases,
  buildManualTestCasesArtifact,
} from './staticArtifacts.js'
import type { InfTestSkill, SkillInput, SkillResult } from './types.js'

type CaseGenerationSubAgent = Pick<SubAgentAdapter, 'invoke'>

function readBooleanEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function shouldUseRealCaseGeneration(): boolean {
  if (readBooleanEnv('INFTEST_REAL_CASE_GENERATION')) return true
  return hasConfiguredRealCaseGenerationCommand()
}

function isStrictRealMode(): boolean {
  return readBooleanEnv('INFTEST_REAL_ONLY')
}

function hasConfiguredRealCaseGenerationCommand(): boolean {
  if (process.env.INFTEST_TEST_GENERATION_AGENT_CMD?.trim()) return true
  const configured = getInfTestConfig()?.subagents?.test_generation?.command
  return Boolean(configured?.trim())
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const MAX_OUTPUT_JSON_CHARS = 512 * 1024

async function buildCaseTreeOutputJson(
  testCasesPath: string,
): Promise<{ output_json: string; step_log_note?: string }> {
  const raw = await readFile(testCasesPath, 'utf8')
  const trimmed = raw.trim()
  if (trimmed.length <= MAX_OUTPUT_JSON_CHARS) {
    return { output_json: trimmed }
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      root?: { children?: unknown[] }
    }
    const children = parsed.root?.children ?? []
    return {
      output_json: JSON.stringify({
        root: { node_id: 'root', children: children.slice(0, 50) },
        _truncated: true,
        case_count: children.length,
        source_path: testCasesPath,
      }),
      step_log_note: `用例树过大已截断（${children.length} 条），完整文件: ${testCasesPath}`,
    }
  } catch {
    return {
      output_json: '{}',
      step_log_note: `用例树过大且无法解析，完整文件: ${testCasesPath}`,
    }
  }
}

export class StaticCaseGenerationSkill implements InfTestSkill {
  readonly name = 'StaticCaseGenerationSkill'
  readonly stage = 'DATA_GEN' as const

  constructor(
    private readonly workspaceManager = new WorkspaceManager(),
    private readonly subAgent: CaseGenerationSubAgent = new SubAgentAdapter(),
  ) {}

  private async runRealCaseGeneration(input: SkillInput): Promise<SkillResult | null> {
    if (!shouldUseRealCaseGeneration()) return null

    const outputPath = join(input.workspace, 'case_generation', 'subagent_output.json')
    const canonicalCasesPath = join(input.workspace, 'case_generation', 'test_cases.json')
    const canonicalResultPath = join(input.workspace, 'case_generation', 'result.json')
    const logsDir = join(input.workspace, 'case_generation', 'logs')

    try {
      logEvent('info', 'case_generation.start', {
        task_id: input.task_id,
        workspace: input.workspace,
        logs_dir: logsDir,
        stderr_log: join(logsDir, 'real_case_generation.stderr.log'),
        cli_agent_logs: process.env.INFTEST_CASE_AGENT_CWD
          ? join(process.env.INFTEST_CASE_AGENT_CWD, 'logs')
          : null,
      })

      const planConfig = loadPlanConfig(input.workspace)
      const extraArgs = buildCaseGenExtraArgs(planConfig)

      const result = await this.subAgent.invoke({
        agent_name: 'test_generation',
        task_id: input.task_id,
        workspace: input.workspace,
        output_json: outputPath,
        extra_args:
          Object.keys(extraArgs).length > 0 ? extraArgs : undefined,
      })

      if (!result.success) {
        logEvent('warn', 'case_generation.subagent_failed', {
          task_id: input.task_id,
          error: result.error,
          exit_code: result.exit_code,
        })
        return null
      }

      const testCasesPath =
        result.output?.artifacts.test_cases ?? result.output?.artifacts.case_tree_json
      if (!testCasesPath || !(await pathExists(testCasesPath))) {
        logEvent('warn', 'case_generation.missing_test_cases_artifact', {
          task_id: input.task_id,
          test_cases_path: testCasesPath ?? null,
        })
        return null
      }

      await copyFile(testCasesPath, canonicalCasesPath)
      ensureDocFormatTestCasesFile(input.workspace, input.task_id)
      const outputRaw = await readFile(outputPath, 'utf8')
      const outputRecord = JSON.parse(outputRaw) as Record<string, unknown>
      const caseTreePayload = await buildCaseTreeOutputJson(testCasesPath)
      const stepLog = buildSubAgentStepLog(result.stdout_log, result.stderr_log)
      const stepLogWithNote = caseTreePayload.step_log_note
        ? `${stepLog}\n${caseTreePayload.step_log_note}`.trim()
        : stepLog
      await this.workspaceManager.writeJson(
        input.workspace,
        'case_generation/result.json',
        {
          success: true,
          source: 'real_subagent',
          agent_name: 'test_generation',
          task_id: input.task_id,
          subagent_output: outputRecord,
          test_cases: canonicalCasesPath,
        },
      )
      return {
        status: 'SUCCESS',
        artifacts: {
          test_generation_result: canonicalResultPath,
          test_cases: canonicalCasesPath,
          subagent_test_generation_result: outputPath,
        },
        message: 'Generated test cases from real test_generation agent',
        telemetry: {
          agent_name: 'test_generation',
          total_tokens: result.output?.metrics?.total_tokens ?? 0,
          output_json: caseTreePayload.output_json,
          step_log: stepLogWithNote,
        },
      }
    } catch (error) {
      logEvent('error', 'case_generation.real_subagent_error', {
        task_id: input.task_id,
        error,
      })
      return null
    }
  }

  async run(input: SkillInput): Promise<SkillResult> {
    if (isStrictRealMode() && !hasConfiguredRealCaseGenerationCommand()) {
      return {
        status: 'FAILED',
        artifacts: {},
        error: {
          code: 'REAL_CASE_GENERATION_COMMAND_MISSING',
          message:
            'Strict real mode requires test_generation launch config (INFTEST_TEST_GENERATION_AGENT_CMD or config.subagents.test_generation.command).',
        },
      }
    }
    const real = await this.runRealCaseGeneration(input)
    if (real) return real
    if (isStrictRealMode()) {
      return {
        status: 'FAILED',
        artifacts: {},
        error: {
          code: 'REAL_CASE_GENERATION_REQUIRED',
          message:
            'Strict real mode is enabled, but real test_generation agent is unavailable. Configure INFTEST_TEST_GENERATION_AGENT_CMD/ARGS/CWD or config.subagents.test_generation.',
        },
      }
    }

    const cases = buildManualCases(input.task_id)
    await this.workspaceManager.writeJson(
      input.workspace,
      'case_generation/test_cases.json',
      buildManualTestCasesArtifact(cases),
    )
    ensureDocFormatTestCasesFile(input.workspace, input.task_id)
    const testCasesPath = join(input.workspace, 'case_generation', 'test_cases.json')
    const resultPath = await this.workspaceManager.writeJson(
      input.workspace,
      'case_generation/result.json',
      {
        success: true,
        source: 'static',
        case_count: cases.length,
        test_cases: cases.map(testCase => testCase.case_id),
      },
    )
    return {
      status: 'SUCCESS',
      artifacts: {
        test_generation_result: resultPath,
        test_cases: testCasesPath,
      },
      message: `Loaded ${cases.length} static test case(s)`,
    }
  }
}
