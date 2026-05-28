import { access, readFile } from 'fs/promises'
import { join } from 'path'
import { SubAgentAdapter } from '../adapters/SubAgentAdapter.js'
import type { InfTestSkill, SkillInput, SkillResult } from './types.js'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export class ReportSkill implements InfTestSkill {
  readonly name = 'ReportSkill'
  readonly stage = 'REFLECTING' as const

  constructor(
    private readonly subAgent = new SubAgentAdapter(),
    private readonly timeoutSeconds?: number,
  ) {}

  async run(input: SkillInput): Promise<SkillResult> {
    const caseResult = join(
      input.workspace,
      'execution',
      'results',
      'case_result.json',
    )
    if (!(await exists(caseResult))) {
      return {
        status: 'FAILED',
        artifacts: {},
        error: {
          code: 'MISSING_CASE_RESULT',
          message: `Missing report input: ${caseResult}`,
        },
      }
    }

    const outputJson = join(input.workspace, 'analysis', 'result.json')
    const result = await this.subAgent.invoke({
      agent_name: 'result_analyzer',
      task_id: input.task_id,
      workspace: input.workspace,
      output_json: outputJson,
      timeout_seconds: this.timeoutSeconds,
      adapter_script: 'scripts/inftest_real_report_agent_adapter.py',
    })
    if (!result.success) {
      return {
        status: 'FAILED',
        artifacts: {
          analysis_result: outputJson,
        },
        error: {
          code: 'REPORT_SKILL_FAILED',
          message: result.error ?? 'Report agent failed',
        },
      }
    }

    const reportPath = join(input.workspace, 'analysis', 'report.md')
    await readFile(reportPath, 'utf8')
    return {
      status: 'SUCCESS',
      artifacts: {
        analysis_result: outputJson,
        analysis_report: reportPath,
        ...(result.output?.artifacts ?? {}),
      },
      message: 'Report agent completed',
    }
  }
}
