import { access, copyFile, readFile } from 'fs/promises'
import { join } from 'path'
import {
  buildSubAgentStepLog,
  SubAgentAdapter,
} from '../adapters/SubAgentAdapter.js'
import { getInfTestConfig } from '../config/loadInfTestConfig.js'
import { WorkspaceManager } from '../adapters/WorkspaceManager.js'
import { readExecutableCasesFromTestCases } from '../server/casePublishArtifacts.js'
import {
  buildDeviceSchedulerExtraArgs,
  loadPlanConfig,
} from '../server/planContextArtifacts.js'
import {
  buildDeviceCaseBindArtifactForCases,
  buildManualCases,
} from './staticArtifacts.js'
import type { InfTestSkill, SkillInput, SkillResult } from './types.js'

type DeviceSchedulerSubAgent = Pick<SubAgentAdapter, 'invoke'>

const REAL_DEVICE_SCHEDULER_ADAPTER =
  'scripts/inftest_real_device_scheduler_adapter.py'

function resolveDeviceId(configuredDeviceId?: string): string {
  if (configuredDeviceId) return configuredDeviceId
  if (process.env.INFTEST_MOCK_DEVICE === '1') {
    return process.env.INFTEST_MOCK_DEVICE_ID ?? 'mock-device-001'
  }
  return process.env.INFTEST_DEVICE_ID ?? 'SM02G4061977180'
}

function readBooleanEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function shouldUseRealDeviceScheduler(): boolean {
  if (readBooleanEnv('INFTEST_REAL_DEVICE_SCHEDULER')) return true
  return hasConfiguredRealDeviceSchedulerCommand()
}

function isStrictRealMode(): boolean {
  return readBooleanEnv('INFTEST_REAL_ONLY')
}

function hasConfiguredRealDeviceSchedulerCommand(): boolean {
  if (process.env.INFTEST_DEVICE_AGENT_CMD?.trim()) return true
  const configured = getInfTestConfig()?.subagents?.device_scheduler?.command
  return Boolean(configured?.trim())
}

function usesBundledDeviceSchedulerAdapter(): boolean {
  return (
    readBooleanEnv('INFTEST_REAL_DEVICE_SCHEDULER') &&
    !process.env.INFTEST_DEVICE_AGENT_CMD?.trim()
  )
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function loadExecutableCases(
  workspace: string,
  taskId: string,
): Promise<ReturnType<typeof buildManualCases>> {
  const testCasesPath = join(workspace, 'case_generation', 'test_cases.json')
  if (!(await pathExists(testCasesPath))) {
    return buildManualCases(taskId)
  }
  const payload = JSON.parse(await readFile(testCasesPath, 'utf8')) as unknown
  const cases = readExecutableCasesFromTestCases(payload)
  return cases.length > 0 ? cases : buildManualCases(taskId)
}

export class DeviceCoordinateSkill implements InfTestSkill {
  readonly name = 'DeviceCoordinateSkill'
  readonly stage = 'COORDINATE' as const

  constructor(
    private readonly workspaceManager = new WorkspaceManager(),
    private readonly deviceId?: string,
    private readonly subAgent: DeviceSchedulerSubAgent = new SubAgentAdapter(),
  ) {}

  private async runRealDeviceScheduler(input: SkillInput): Promise<SkillResult> {
    const outputPath = join(input.workspace, 'device_scheduling', 'subagent_output.json')
    const canonicalBindPath = join(
      input.workspace,
      'device_scheduling',
      'device_case_bind.json',
    )
    const canonicalBindingsPath = join(
      input.workspace,
      'device_scheduling',
      'device_bindings.json',
    )
    const canonicalResultPath = join(input.workspace, 'device_scheduling', 'result.json')
    const planConfig = loadPlanConfig(input.workspace)
    const extraArgs = buildDeviceSchedulerExtraArgs(planConfig)

    try {
      const result = await this.subAgent.invoke({
        agent_name: 'device_scheduler',
        task_id: input.task_id,
        workspace: input.workspace,
        output_json: outputPath,
        extra_args: Object.keys(extraArgs).length > 0 ? extraArgs : undefined,
        adapter_script: usesBundledDeviceSchedulerAdapter()
          ? REAL_DEVICE_SCHEDULER_ADAPTER
          : undefined,
      })
      if (!result.success) {
        return {
          status: 'FAILED',
          artifacts: {},
          error: {
            code: 'DEVICE_SCHEDULER_INVOKE_FAILED',
            message:
              result.error ??
              'device_scheduler sub-agent exited without success',
          },
          telemetry: {
            agent_name: 'device_scheduler',
            output_json: result.output_json,
            step_log: buildSubAgentStepLog(result.stdout_log, result.stderr_log),
          },
        }
      }

      const bindFromSubagent =
        result.output?.artifacts.device_case_bind ??
        result.output?.artifacts.device_case_bindings
      const bindingsFromSubagent = result.output?.artifacts.device_bindings

      if (!bindFromSubagent || !(await pathExists(bindFromSubagent))) {
        return {
          status: 'FAILED',
          artifacts: {},
          error: {
            code: 'DEVICE_CASE_BIND_MISSING',
            message:
              'Real device_scheduler did not produce device_case_bind.json',
          },
          telemetry: {
            agent_name: 'device_scheduler',
            output_json: result.output_json,
            step_log: buildSubAgentStepLog(result.stdout_log, result.stderr_log),
          },
        }
      }

      await copyFile(bindFromSubagent, canonicalBindPath)

      if (bindingsFromSubagent && (await pathExists(bindingsFromSubagent))) {
        await copyFile(bindingsFromSubagent, canonicalBindingsPath)
      } else {
        const bindPayload = JSON.parse(await readFile(canonicalBindPath, 'utf8')) as unknown
        await this.workspaceManager.writeJson(
          input.workspace,
          'device_scheduling/device_bindings.json',
          bindPayload,
        )
      }

      const outputRaw = await readFile(outputPath, 'utf8')
      const outputRecord = JSON.parse(outputRaw) as Record<string, unknown>
      const scheduleInfoPath = result.output?.artifacts.device_scheduling_info
      await this.workspaceManager.writeJson(input.workspace, 'device_scheduling/result.json', {
        success: true,
        source: 'real_subagent',
        agent_name: 'device_scheduler',
        task_id: input.task_id,
        subagent_output: outputRecord,
        device_case_bind: canonicalBindPath,
        device_bindings: canonicalBindingsPath,
        ...(scheduleInfoPath ? { schedule_info: scheduleInfoPath } : {}),
      })
      return {
        status: 'SUCCESS',
        artifacts: {
          device_scheduling_result: canonicalResultPath,
          device_case_bind: canonicalBindPath,
          device_bindings: canonicalBindingsPath,
          subagent_device_scheduler_result: outputPath,
        },
        message: 'Generated device bindings from real device_scheduler agent',
        telemetry: {
          agent_name: 'device_scheduler',
          total_tokens: result.output?.metrics?.total_tokens ?? 0,
          output_json: outputRaw,
          step_log: buildSubAgentStepLog(result.stdout_log, result.stderr_log),
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        status: 'FAILED',
        artifacts: {},
        error: {
          code: 'DEVICE_SCHEDULER_INVOKE_ERROR',
          message,
        },
      }
    }
  }

  async run(input: SkillInput): Promise<SkillResult> {
    const realSchedulerConfigured =
      hasConfiguredRealDeviceSchedulerCommand() ||
      usesBundledDeviceSchedulerAdapter()

    if (isStrictRealMode() && !realSchedulerConfigured) {
      return {
        status: 'FAILED',
        artifacts: {},
        error: {
          code: 'REAL_DEVICE_SCHEDULER_COMMAND_MISSING',
          message:
            'Strict real mode requires INFTEST_DEVICE_AGENT_CMD, config.subagents.device_scheduler, or INFTEST_REAL_DEVICE_SCHEDULER=1.',
        },
      }
    }

    if (shouldUseRealDeviceScheduler()) {
      return this.runRealDeviceScheduler(input)
    }

    if (isStrictRealMode()) {
      return {
        status: 'FAILED',
        artifacts: {},
        error: {
          code: 'REAL_DEVICE_SCHEDULING_REQUIRED',
          message:
            'Strict real mode is enabled, but real device_scheduler is unavailable. Set INFTEST_REAL_DEVICE_SCHEDULER=1 or INFTEST_DEVICE_AGENT_CMD.',
        },
      }
    }

    const resolvedDevice = resolveDeviceId(this.deviceId)
    const cases = await loadExecutableCases(input.workspace, input.task_id)
    const bind = buildDeviceCaseBindArtifactForCases(resolvedDevice, cases)
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
        source: 'local_static_bind',
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
      message: 'Device case binding generated (local static bind)',
    }
  }
}
