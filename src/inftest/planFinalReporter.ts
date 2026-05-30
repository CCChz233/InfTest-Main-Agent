import { ProxyClient } from './adapters/ProxyClient.js'
import { resolvePlanIdFromWorkspace } from './server/reportCompletionReporter.js'

function inferPlanId(taskId: string): string {
  const match = /^(.*)-task-\d+$/.exec(taskId)
  if (match?.[1]) return match[1]
  return taskId
}

export async function reportPlanFinalStatusWithUpload(input: {
  task_id: string
  task_status: 'SUCCESS' | 'FAILED'
  workspace?: string
  analysis_report_path?: string | null
  report_file_key?: string | null
  message?: string
  proxy_client?: ProxyClient
}): Promise<void> {
  const proxy = input.proxy_client ?? new ProxyClient()
  const planId = input.workspace
    ? resolvePlanIdFromWorkspace(input.workspace, input.task_id)
    : inferPlanId(input.task_id)

  await proxy.reportPlanFinalStatus({
    plan_id: planId,
    task_id: input.task_id,
    task_status: input.task_status,
    message: input.message,
  })
}
