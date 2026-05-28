import { access, readFile } from 'fs/promises'
import { join } from 'path'
import { SubAgentAdapter } from '../adapters/SubAgentAdapter.js'
import type { InfTestSkill, SkillInput, SkillResult } from './types.js'

async function assertReadable(
  path: string,
  code: string,
): Promise<SkillResult | null> {
  try {
    await access(path)
    return null
  } catch {
    return {
      status: 'FAILED',
      artifacts: {},
      error: {
        code,
        message: `Missing required artifact: ${path}`,
      },
    }
  }
}

export class ExecutionSkill implements InfTestSkill {
  readonly name = 'ExecutionSkill'
  readonly stage = 'EXECUTING' as const

  constructor(
    private readonly subAgent = new SubAgentAdapter(),
    private readonly timeoutSeconds?: number,
  ) {}

  async run(input: SkillInput): Promise<SkillResult> {
    const outputJson = join(input.workspace, 'execution', 'result.json')
    const result = await this.subAgent.invoke({
      agent_name: 'test_executor',
      task_id: input.task_id,
      workspace: input.workspace,
      output_json: outputJson,
      timeout_seconds: this.timeoutSeconds,
      adapter_script: 'scripts/inftest_real_execution_agent_adapter.py',
    })
    if (!result.success) {
      return {
        status: 'FAILED',
        artifacts: {
          execution_result: outputJson,
        },
        error: {
          code: 'EXECUTION_SKILL_FAILED',
          message: result.error ?? 'Execution agent failed',
        },
      }
    }

    const caseResult = join(
      input.workspace,
      'execution',
      'results',
      'case_result.json',
    )
    const summary = join(
      input.workspace,
      'execution',
      'results',
      'summary.json',
    )
    const missingCaseResult = await assertReadable(
      caseResult,
      'CASE_RESULT_NOT_FOUND',
    )
    if (missingCaseResult) return missingCaseResult
    const missingSummary = await assertReadable(
      summary,
      'EXECUTION_SUMMARY_NOT_FOUND',
    )
    if (missingSummary) return missingSummary

    await readFile(summary, 'utf8')
    return {
      status: 'SUCCESS',
      artifacts: {
        execution_result: outputJson,
        report_agent_log: caseResult,
        execution_summary: summary,
        ...(result.output?.artifacts ?? {}),
      },
      message: 'Execution agent completed',
    }
  }
}
