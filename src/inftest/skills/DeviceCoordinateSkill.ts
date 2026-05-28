import { WorkspaceManager } from '../adapters/WorkspaceManager.js'
import {
  buildDeviceCaseBindArtifact,
  buildManualCases,
} from './staticArtifacts.js'
import type { InfTestSkill, SkillInput, SkillResult } from './types.js'

function resolveDeviceId(configuredDeviceId?: string): string {
  if (configuredDeviceId) return configuredDeviceId
  if (process.env.INFTEST_MOCK_DEVICE === '1') {
    return process.env.INFTEST_MOCK_DEVICE_ID ?? 'mock-device-001'
  }
  return process.env.INFTEST_DEVICE_ID ?? 'SM02G4061977180'
}

export class DeviceCoordinateSkill implements InfTestSkill {
  readonly name = 'DeviceCoordinateSkill'
  readonly stage = 'COORDINATE' as const

  constructor(
    private readonly workspaceManager = new WorkspaceManager(),
    private readonly deviceId?: string,
  ) {}

  async run(input: SkillInput): Promise<SkillResult> {
    const cases = buildManualCases(input.task_id)
    const bind = buildDeviceCaseBindArtifact(
      resolveDeviceId(this.deviceId),
      cases[0],
    )
    const bindPath = await this.workspaceManager.writeJson(
      input.workspace,
      'device_scheduling/device_case_bind.json',
      bind,
    )
    const bindingsPath = await this.workspaceManager.writeJson(
      input.workspace,
      'device_scheduling/device_bindings.json',
      bind,
    )
    const resultPath = await this.workspaceManager.writeJson(
      input.workspace,
      'device_scheduling/result.json',
      {
        success: true,
        device_count: 1,
        case_count: cases.length,
      },
    )
    return {
      status: 'SUCCESS',
      artifacts: {
        device_scheduling_result: resultPath,
        device_case_bind: bindPath,
        device_bindings: bindingsPath,
      },
      message: 'Device case binding generated',
    }
  }
}
