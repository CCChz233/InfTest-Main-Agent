import { access, readFile } from 'fs/promises'
import { join } from 'path'
import { SubAgentAdapter } from '../adapters/SubAgentAdapter.js'
import {
  buildDefectListFromReportAgent,
  buildReportCompletionOutputJson,
  buildReportFilesOutputPayload,
  findReportDocxFiles,
} from '../server/reportCompletionReporter.js'
import { buildReportAgentExtraArgs } from '../server/userInstructionStore.js'
import type { InfTestSkill, SkillInput, SkillResult } from './types.js'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function buildReportTelemetry(
  workspace: string,
  artifactHints?: Record<string, string>,
  stepLog = 'Report generation completed',
) {
  const defectList = buildDefectListFromReportAgent(workspace)
  const reportDocxFiles = findReportDocxFiles(workspace, artifactHints)
  const reportFiles = reportDocxFiles.map(item => ({
    kind: item.kind,
    path: item.path,
    file_name: item.file_name,
    file_key: null,
  }))
  return {
    agent_name: 'result_analyzer' as const,
    output_json: buildReportCompletionOutputJson(
      defectList,
      buildReportFilesOutputPayload(reportFiles),
    ),
    step_log: stepLog,
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
    const reportPath = join(input.workspace, 'analysis', 'report.md')
    if (await exists(reportPath)) {
      const outputJson = join(input.workspace, 'analysis', 'result.json')
      return {
        status: 'SUCCESS',
        artifacts: {
          analysis_result: outputJson,
          analysis_report: reportPath,
        },
        message: 'Report already generated',
        telemetry: buildReportTelemetry(
          input.workspace,
          undefined,
          'Report already generated',
        ),
      }
    }

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
      extra_args: buildReportAgentExtraArgs(input.workspace),
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

    await readFile(reportPath, 'utf8')
    const mergedArtifacts = {
      analysis_result: outputJson,
      analysis_report: reportPath,
      ...(result.output?.artifacts ?? {}),
    }
    return {
      status: 'SUCCESS',
      artifacts: mergedArtifacts,
      message: 'Report agent completed',
      telemetry: buildReportTelemetry(input.workspace, mergedArtifacts),
    }
  }
}
