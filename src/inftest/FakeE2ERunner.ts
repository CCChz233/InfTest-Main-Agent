import { readFile } from 'fs/promises'
import { join } from 'path'
import { ExecutionResultWatcher } from './adapters/ExecutionResultWatcher.js'
import { ProxyClient } from './adapters/ProxyClient.js'
import { SubAgentAdapter } from './adapters/SubAgentAdapter.js'
import { WorkspaceManager } from './adapters/WorkspaceManager.js'
import type { PlanDag } from './schemas/plan.js'
import type { InfTestStage, TaskStatus } from './schemas/task.js'

export const DEFAULT_INFTEST_FAKE_TASK_ID = 'task-demo-001'

export type RunInfTestFakeE2EInput = {
  task_id?: string
  workspace_root?: string
  timeout_seconds?: number
}

export type InfTestFakeE2EStep = {
  name: string
  status: 'SUCCESS' | 'FAILED'
  duration_ms: number
  message?: string
}

export type InfTestFakeE2EResult = {
  task_id: string
  status: Extract<TaskStatus, 'SUCCESS' | 'FAILED'>
  workspace: string
  plan_path: string | null
  artifacts: Record<string, string>
  reported_cases: string[]
  summary_found: boolean
  steps: InfTestFakeE2EStep[]
  error: string | null
}

type StepAction<T> = () => Promise<T>

function buildFakePlanDag(taskId: string): PlanDag {
  return {
    task_id: taskId,
    version: 'fake-e2e-v1',
    nodes: [
      {
        id: 'plan',
        stage: 'PLANNING',
        title: 'Create deterministic fake test plan',
      },
      {
        id: 'generate_cases',
        stage: 'DATA_GEN',
        title: 'Generate login test cases',
        depends_on: ['plan'],
      },
      {
        id: 'schedule_device',
        stage: 'COORDINATE',
        title: 'Bind generated cases to fake device',
        depends_on: ['generate_cases'],
      },
      {
        id: 'execute_cases',
        stage: 'EXECUTING',
        title: 'Execute generated fake cases',
        depends_on: ['schedule_device'],
      },
      {
        id: 'analyze_results',
        stage: 'REFLECTING',
        title: 'Analyze fake execution results',
        depends_on: ['execute_cases'],
      },
      {
        id: 'complete',
        stage: 'COMPLETED',
        title: 'Report final task status',
        depends_on: ['analyze_results'],
      },
    ],
    edges: [
      { from: 'plan', to: 'generate_cases' },
      { from: 'generate_cases', to: 'schedule_device' },
      { from: 'schedule_device', to: 'execute_cases' },
      { from: 'execute_cases', to: 'analyze_results' },
      { from: 'analyze_results', to: 'complete' },
    ],
  }
}

async function runStep<T>(
  steps: InfTestFakeE2EStep[],
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

function ensureSubAgentSuccess(agentName: string, result: { success: boolean
  error: string | null
  stderr_log: string
}): void {
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
    event_id: `${taskId}:stage:${stage.toLowerCase()}`,
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
    event_id: `${taskId}:final:${status.toLowerCase()}`,
    task_id: taskId,
    task_status: status,
    current_stage: 'COMPLETED',
    message,
    stage_operations: [],
    case_node_operations: [],
    case_detail_operations: [],
  })
}

export async function runInfTestFakeE2E(
  input: RunInfTestFakeE2EInput = {},
): Promise<InfTestFakeE2EResult> {
  const taskId = input.task_id ?? DEFAULT_INFTEST_FAKE_TASK_ID
  const workspaceManager = new WorkspaceManager(input.workspace_root)
  const workspace = workspaceManager.getTaskWorkspace(taskId)
  const proxy = new ProxyClient()
  const subAgent = new SubAgentAdapter()
  const steps: InfTestFakeE2EStep[] = []
  const artifacts = {
    plan: join(workspace, 'plan.json'),
    test_generation_result: join(workspace, 'case_generation', 'result.json'),
    test_cases: join(workspace, 'case_generation', 'test_cases.json'),
    device_scheduling_result: join(
      workspace,
      'device_scheduling',
      'result.json',
    ),
    device_bindings: join(
      workspace,
      'device_scheduling',
      'device_bindings.json',
    ),
    execution_result: join(workspace, 'execution', 'result.json'),
    execution_results_dir: join(workspace, 'execution', 'results'),
    execution_summary: join(workspace, 'execution', 'results', 'summary.json'),
    analysis_result: join(workspace, 'analysis', 'result.json'),
    analysis_report: join(workspace, 'analysis', 'report.md'),
  }

  let reportedCases: string[] = []
  let summaryFound = false
  let planPath: string | null = null

  try {
    await runStep(steps, 'get_task_detail', async () => {
      const task = await proxy.getTaskDetail(taskId)
      await reportStage(proxy, taskId, 'PLANNING', task.task_target)
      return task
    })

    await runStep(steps, 'init_workspace', async () => {
      return workspaceManager.init(taskId)
    })

    await runStep(steps, 'write_plan_dag', async () => {
      planPath = await workspaceManager.writeJson(
        workspace,
        'plan.json',
        buildFakePlanDag(taskId),
      )
      await readJsonArtifact(planPath)
      return planPath
    })

    await runStep(steps, 'invoke_subagent:test_generation', async () => {
      await reportStage(proxy, taskId, 'DATA_GEN', 'Generating test cases')
      const result = await subAgent.invoke({
        agent_name: 'test_generation',
        task_id: taskId,
        workspace,
        output_json: artifacts.test_generation_result,
        timeout_seconds: input.timeout_seconds,
      })
      ensureSubAgentSuccess('test_generation', result)
      await readJsonArtifact(artifacts.test_generation_result)
      await readJsonArtifact(artifacts.test_cases)
      return result
    })

    await runStep(steps, 'invoke_subagent:device_scheduler', async () => {
      await reportStage(proxy, taskId, 'COORDINATE', 'Scheduling fake device')
      const result = await subAgent.invoke({
        agent_name: 'device_scheduler',
        task_id: taskId,
        workspace,
        output_json: artifacts.device_scheduling_result,
        timeout_seconds: input.timeout_seconds,
      })
      ensureSubAgentSuccess('device_scheduler', result)
      await readJsonArtifact(artifacts.device_scheduling_result)
      await readJsonArtifact(artifacts.device_bindings)
      return result
    })

    await runStep(steps, 'invoke_subagent:test_executor', async () => {
      await reportStage(proxy, taskId, 'EXECUTING', 'Executing fake cases')
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

    await runStep(steps, 'invoke_subagent:result_analyzer', async () => {
      await reportStage(proxy, taskId, 'REFLECTING', 'Analyzing fake results')
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
      await reportFinalStatus(proxy, taskId, 'SUCCESS', 'Fake E2E completed')
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
