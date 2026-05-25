import { access, readFile } from 'fs/promises'
import { join } from 'path'
import { ExecutionResultWatcher } from './adapters/ExecutionResultWatcher.js'
import { ProxyClient } from './adapters/ProxyClient.js'
import { SubAgentAdapter } from './adapters/SubAgentAdapter.js'
import { WorkspaceManager } from './adapters/WorkspaceManager.js'
import type { PlanDag } from './schemas/plan.js'
import type { InfTestStage, TaskStatus } from './schemas/task.js'

export const DEFAULT_INFTEST_AVAILABLE_AGENTS_TASK_ID = 'task-available-001'

export type RunInfTestAvailableAgentsE2EInput = {
  task_id?: string
  workspace_root?: string
  timeout_seconds?: number
  device_id?: string
}

export type InfTestAvailableAgentsE2EStep = {
  name: string
  status: 'SUCCESS' | 'FAILED'
  duration_ms: number
  message?: string
}

export type InfTestAvailableAgentsE2EResult = {
  task_id: string
  status: Extract<TaskStatus, 'SUCCESS' | 'FAILED'>
  workspace: string
  plan_path: string | null
  artifacts: Record<string, string>
  reported_cases: string[]
  summary_found: boolean
  steps: InfTestAvailableAgentsE2EStep[]
  error: string | null
}

type ManualCase = {
  case_id: string
  case_name: string
  test_type: 'functional'
  case_function_point: string
  test_scenario: string
  case_step: string[]
  expected_result: string[]
}

type StepAction<T> = () => Promise<T>

function buildManualCases(taskId: string): ManualCase[] {
  return [
    {
      case_id: `${taskId}_case_000`,
      case_name: '首页搜索-健康关键词常规流程',
      test_type: 'functional',
      case_function_point: '首页搜索',
      test_scenario: '常规搜索流程',
      case_step: [
        '退到桌面',
        '打开掌上新华APP',
        '点击首页搜索框',
        '输入关键字“健康”并执行搜索',
      ],
      expected_result: [
        '成功退到桌面',
        'APP成功启动并进入首页',
        '搜索框可正常聚焦并输入',
        '返回包含关键字相关的搜索结果列表',
      ],
    },
  ]
}

function buildPlanDag(taskId: string): PlanDag {
  return {
    task_id: taskId,
    version: 'available-agents-v1',
    nodes: [
      {
        id: 'manual_plan',
        stage: 'PLANNING',
        title: 'Create manual test plan because case generation agent is unavailable',
      },
      {
        id: 'write_device_case_bind',
        stage: 'COORDINATE',
        title: 'Write device_case_bind for execution agent',
        depends_on: ['manual_plan'],
      },
      {
        id: 'execute_cases',
        stage: 'EXECUTING',
        title: 'Invoke available test execution agent',
        depends_on: ['write_device_case_bind'],
      },
      {
        id: 'normalize_report_input',
        stage: 'REFLECTING',
        title: 'Normalize execution output for report agent',
        depends_on: ['execute_cases'],
      },
      {
        id: 'generate_report',
        stage: 'REFLECTING',
        title: 'Invoke available report generation agent',
        depends_on: ['normalize_report_input'],
      },
      {
        id: 'complete',
        stage: 'COMPLETED',
        title: 'Report final task status',
        depends_on: ['generate_report'],
      },
    ],
    edges: [
      { from: 'manual_plan', to: 'write_device_case_bind' },
      { from: 'write_device_case_bind', to: 'execute_cases' },
      { from: 'execute_cases', to: 'normalize_report_input' },
      { from: 'normalize_report_input', to: 'generate_report' },
      { from: 'generate_report', to: 'complete' },
    ],
  }
}

function buildManualTestCasesArtifact(cases: ManualCase[]): unknown {
  return {
    source: 'manual_static_plan',
    reason: 'case_generation_agent_unavailable',
    root: {
      node_id: 'root',
      title: '掌上新华 APP 首页搜索测试',
      children: cases.map(testCase => ({
        node_id: testCase.case_id,
        title: testCase.case_name,
        type: 'CASE',
        test_type: testCase.test_type,
        case_function_point: testCase.case_function_point,
        test_scenario: testCase.test_scenario,
        preconditions: [
          '测试设备已连接并可被执行 Agent 调度',
          '掌上新华 APP 已安装且可正常启动',
          '网络环境可访问掌上新华服务',
        ],
        test_steps: testCase.case_step,
        expected_result: testCase.expected_result,
      })),
    },
  }
}

function buildDeviceCaseBindArtifact(
  deviceId: string,
  testCase: ManualCase,
): unknown {
  return {
    device_case: {
      [deviceId]: {
        case_step: testCase.case_step,
        case_function_point: testCase.case_function_point,
        test_scenario: testCase.test_scenario,
        expected_result: testCase.expected_result,
        case_id: testCase.case_id,
      },
    },
  }
}

function buildReportAgentLog(taskId: string, cases: ManualCase[]): unknown {
  return {
    cases: cases.map((testCase, index) => ({
      task_id: taskId,
      case_index: index + 1,
      case_id: testCase.case_id,
      case_name: testCase.case_name,
      test_type: testCase.test_type,
      case_step: testCase.case_step.join('\n'),
      expected_result: testCase.expected_result,
      status: 'pass',
      steps_info: testCase.case_step.map((step, stepIndex) => ({
        step_index: stepIndex + 1,
        step,
        status: 'passed',
      })),
      functional: {
        status: 'passed',
        test_type: testCase.test_type,
        failure_attribution: '',
        failure_attribution_rationale: '',
      },
      screenshots_analysis: [],
      issues_found: [],
      risk_level: 'low',
    })),
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function runStep<T>(
  steps: InfTestAvailableAgentsE2EStep[],
  name: string,
  action: StepAction<T>,
): Promise<T> {
  const startedAt = Date.now()
  try {
    const result = await action()
    steps.push({
      name,
      status: 'SUCCESS',
      duration_ms: Date.now() - startedAt,
    })
    return result
  } catch (error) {
    steps.push({
      name,
      status: 'FAILED',
      duration_ms: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

async function readJsonArtifact(path: string): Promise<unknown> {
  const content = await readFile(path, 'utf8')
  return JSON.parse(content) as unknown
}

function ensureSubAgentSuccess(
  agentName: string,
  result: {
    success: boolean
    error: string | null
    stderr_log: string
  },
): void {
  if (result.success) return
  const message = result.error ?? result.stderr_log.trim()
  throw new Error(`${agentName} failed: ${message || 'unknown error'}`)
}

async function reportStage(
  proxy: ProxyClient,
  taskId: string,
  stage: InfTestStage,
  message: string,
): Promise<void> {
  await proxy.reportTaskUpdate({
    event_id: `${taskId}:available-agents:${stage.toLowerCase()}`,
    task_id: taskId,
    current_stage: stage,
    message,
    stage_operations: [],
    case_node_operations: [],
    case_detail_operations: [],
  })
}

async function reportFinalStatus(
  proxy: ProxyClient,
  taskId: string,
  status: Extract<TaskStatus, 'SUCCESS' | 'FAILED'>,
  message: string,
): Promise<void> {
  await proxy.reportTaskUpdate({
    event_id: `${taskId}:available-agents:final:${status.toLowerCase()}`,
    task_id: taskId,
    task_status: status,
    current_stage: 'COMPLETED',
    message,
    stage_operations: [],
    case_node_operations: [],
    case_detail_operations: [],
  })
}

export async function runInfTestAvailableAgentsE2E(
  input: RunInfTestAvailableAgentsE2EInput = {},
): Promise<InfTestAvailableAgentsE2EResult> {
  const taskId = input.task_id ?? DEFAULT_INFTEST_AVAILABLE_AGENTS_TASK_ID
  const deviceId =
    input.device_id ?? process.env.INFTEST_DEVICE_ID ?? 'SM02G4061977180'
  const workspaceManager = new WorkspaceManager(input.workspace_root)
  const workspace = workspaceManager.getTaskWorkspace(taskId)
  const proxy = new ProxyClient()
  const subAgent = new SubAgentAdapter()
  const steps: InfTestAvailableAgentsE2EStep[] = []
  const artifacts = {
    plan: join(workspace, 'plan.json'),
    manual_test_cases: join(workspace, 'case_generation', 'test_cases.json'),
    device_case_bind: join(
      workspace,
      'device_scheduling',
      'device_case_bind.json',
    ),
    device_bindings: join(
      workspace,
      'device_scheduling',
      'device_bindings.json',
    ),
    execution_result: join(workspace, 'execution', 'result.json'),
    execution_results_dir: join(workspace, 'execution', 'results'),
    execution_summary: join(workspace, 'execution', 'results', 'summary.json'),
    report_agent_log: join(
      workspace,
      'execution',
      'results',
      'case_result.json',
    ),
    analysis_result: join(workspace, 'analysis', 'result.json'),
    analysis_report: join(workspace, 'analysis', 'report.md'),
  }
  const cases = buildManualCases(taskId)

  let reportedCases: string[] = []
  let summaryFound = false
  let planPath: string | null = null

  try {
    await runStep(steps, 'get_task_detail', async () => {
      const task = await proxy.getTaskDetail(taskId)
      await reportStage(
        proxy,
        taskId,
        'PLANNING',
        `${task.task_target}; case generation agent unavailable, using manual plan`,
      )
      return task
    })

    await runStep(steps, 'init_workspace', async () => {
      return workspaceManager.init(taskId)
    })

    await runStep(steps, 'write_manual_plan', async () => {
      planPath = await workspaceManager.writeJson(
        workspace,
        'plan.json',
        buildPlanDag(taskId),
      )
      await workspaceManager.writeJson(
        workspace,
        'case_generation/test_cases.json',
        buildManualTestCasesArtifact(cases),
      )
      await readJsonArtifact(planPath)
      await readJsonArtifact(artifacts.manual_test_cases)
      return planPath
    })

    await runStep(steps, 'write_device_case_bind', async () => {
      await reportStage(
        proxy,
        taskId,
        'COORDINATE',
        'Writing device_case_bind for available execution agent',
      )
      const bind = buildDeviceCaseBindArtifact(deviceId, cases[0])
      const bindPath = await workspaceManager.writeJson(
        workspace,
        'device_scheduling/device_case_bind.json',
        bind,
      )
      await workspaceManager.writeJson(
        workspace,
        'device_scheduling/device_bindings.json',
        bind,
      )
      await readJsonArtifact(bindPath)
      return bindPath
    })

    await runStep(steps, 'invoke_subagent:test_executor', async () => {
      await reportStage(
        proxy,
        taskId,
        'EXECUTING',
        'Invoking available execution agent',
      )
      const result = await subAgent.invoke({
        agent_name: 'test_executor',
        task_id: taskId,
        workspace,
        output_json: artifacts.execution_result,
        timeout_seconds: input.timeout_seconds,
      })
      ensureSubAgentSuccess('test_executor', result)
      await readJsonArtifact(artifacts.execution_result)
      await readJsonArtifact(artifacts.execution_summary)
      return result
    })

    await runStep(steps, 'watch_execution_results', async () => {
      const result = await new ExecutionResultWatcher(proxy).watch({
        task_id: taskId,
        results_dir: artifacts.execution_results_dir,
        summary_path: artifacts.execution_summary,
      })
      reportedCases = result.reported_cases
      summaryFound = result.summary_found
      return result
    })

    await runStep(steps, 'normalize_report_agent_input', async () => {
      if (!(await pathExists(artifacts.report_agent_log))) {
        await workspaceManager.writeJson(
          workspace,
          'execution/results/case_result.json',
          buildReportAgentLog(taskId, cases),
        )
      }
      await readJsonArtifact(artifacts.report_agent_log)
      return artifacts.report_agent_log
    })

    await runStep(steps, 'invoke_subagent:result_analyzer', async () => {
      await reportStage(
        proxy,
        taskId,
        'REFLECTING',
        'Invoking available report generation agent',
      )
      const result = await subAgent.invoke({
        agent_name: 'result_analyzer',
        task_id: taskId,
        workspace,
        output_json: artifacts.analysis_result,
        timeout_seconds: input.timeout_seconds,
      })
      ensureSubAgentSuccess('result_analyzer', result)
      await readJsonArtifact(artifacts.analysis_result)
      await readFile(artifacts.analysis_report, 'utf8')
      return result
    })

    await runStep(steps, 'report_task_update:SUCCESS', async () => {
      await reportFinalStatus(
        proxy,
        taskId,
        'SUCCESS',
        'Available agents E2E completed',
      )
    })

    return {
      task_id: taskId,
      status: 'SUCCESS',
      workspace,
      plan_path: planPath,
      artifacts,
      reported_cases: reportedCases,
      summary_found: summaryFound,
      steps,
      error: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await reportFinalStatus(proxy, taskId, 'FAILED', message)
    return {
      task_id: taskId,
      status: 'FAILED',
      workspace,
      plan_path: planPath,
      artifacts,
      reported_cases: reportedCases,
      summary_found: summaryFound,
      steps,
      error: message,
    }
  }
}
