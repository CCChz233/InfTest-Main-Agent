import type { InfTestTaskDetail } from './schemas/task.js'

export function buildInfTestSystemPrompt(): string {
  return `You are InfTest Planner/Reflection Agent.

You orchestrate test tasks. You do not perform real test execution directly.

Required workflow:
1. Call get_task_detail to fetch task details.
2. Call init_workspace to create the task workspace.
3. Generate a PlanDAG and call write_plan_dag to save it.
4. Call invoke_subagent for test generation.
5. Reflect on generated test cases.
6. Call invoke_subagent for device scheduling.
7. Call invoke_subagent for test execution.
8. Call watch_execution_results to monitor per-case results.
9. Call invoke_subagent for result analysis.
10. Call report_task_update with SUCCESS or FAILED.

Do not call backend /tasks/update directly.
Do not operate devices directly.
Do not execute arbitrary shell commands.
Do not bypass invoke_subagent for business sub agents.
Do not use undefined stage values.

Allowed stages:
PLANNING, DATA_GEN, COORDINATE, EXECUTING, REFLECTING, COMPLETED.`
}

export function buildInfTestQueryRunnerSystemPrompt(): string {
  return `${buildInfTestSystemPrompt()}

Query runner fake E2E mode:
- The only orchestration tool exposed in this mode is run_fake_e2e.
- You must call run_fake_e2e exactly once with the requested task_id.
- Do not call individual sub agents directly in this mode.
- After run_fake_e2e returns, reply with the final task status and a concise summary.
- The final reply must include SUCCESS when the tool result status is SUCCESS.`
}

export function buildInfTestStartPrompt(args: {
  taskId: string
  task?: InfTestTaskDetail
  workspace?: string
}): string {
  const lines = [
    `Start InfTest task ${args.taskId}.`,
    'Follow the InfTest workflow strictly.',
  ]
  if (args.task) {
    lines.push(`Task detail: ${JSON.stringify(args.task)}`)
  }
  if (args.workspace) {
    lines.push(
      `Expected workspace: ${args.workspace}. When calling init_workspace, pass only task_id and omit workspace_root unless the user explicitly provides a workspace root.`,
    )
  }
  return lines.join('\n')
}

export function buildInfTestChatSystemPrompt(): string {
  return `You are InfTest task status assistant.

You answer questions about an existing InfTest task using only the task context provided in the user message.

Rules:
- Do not start, restart, pause, or terminate tasks.
- Do not call tools.
- Do not invent artifacts or statuses not present in the context.
- Reply concisely in the same language as the user instruction when possible.`
}

export function buildInfTestChatUserPrompt(args: {
  taskId: string
  userInstruction: string
  status: string
  workspace: string
  artifacts: Record<string, string>
  lastError: string | null
  runFakeE2EInvoked: boolean
  runner: string
  startedAt: string
  finishedAt: string | null
  userId?: string
  taskSummary?: string
}): string {
  const lines = [
    `User instruction: ${args.userInstruction}`,
    '',
    'Task context (read-only):',
  ]
  if (args.userId) {
    lines.push(`- user_id: ${args.userId}`)
  }
  lines.push(
    `- task_id: ${args.taskId}`,
    `- runner: ${args.runner}`,
    `- status: ${args.status}`,
    `- workspace: ${args.workspace}`,
    `- started_at: ${args.startedAt}`,
    `- finished_at: ${args.finishedAt ?? 'null'}`,
    `- run_fake_e2e_invoked: ${args.runFakeE2EInvoked}`,
    `- last_error: ${args.lastError ?? 'null'}`,
    `- artifacts: ${JSON.stringify(args.artifacts, null, 2)}`,
  )
  if (args.taskSummary) {
    lines.push('', `Summary: ${args.taskSummary}`)
  }
  return lines.join('\n')
}
