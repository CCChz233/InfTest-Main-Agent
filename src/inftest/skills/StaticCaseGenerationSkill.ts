import { WorkspaceManager } from '../adapters/WorkspaceManager.js'
import {
  buildManualCases,
  buildManualTestCasesArtifact,
} from './staticArtifacts.js'
import type { InfTestSkill, SkillInput, SkillResult } from './types.js'

export class StaticCaseGenerationSkill implements InfTestSkill {
  readonly name = 'StaticCaseGenerationSkill'
  readonly stage = 'DATA_GEN' as const

  constructor(private readonly workspaceManager = new WorkspaceManager()) {}

  async run(input: SkillInput): Promise<SkillResult> {
    const cases = buildManualCases(input.task_id)
    const testCasesPath = await this.workspaceManager.writeJson(
      input.workspace,
      'case_generation/test_cases.json',
      buildManualTestCasesArtifact(cases),
    )
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
