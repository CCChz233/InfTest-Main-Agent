import type { InfTestTaskDetail } from '../schemas/task.js'
import type { TaskUpdate } from '../schemas/update.js'

export type ReportTaskUpdateResult = {
  accepted: true
  event_id: string
  task_id: string
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/$/, '')
  const suffix = path.startsWith('/') ? path.slice(1) : path
  return `${trimmed}/${suffix}`
}

function getProxyBaseUrl(): string {
  return process.env.INFTEST_PROXY_BASE_URL?.trim() ?? ''
}

function getTaskReportPath(): string {
  return (
    process.env.INFTEST_PROXY_TASK_REPORT_PATH?.trim() ?? 'api/inftest/task_report'
  )
}

export class ProxyClient {
  async getTaskDetail(taskId: string): Promise<InfTestTaskDetail> {
    const base = getProxyBaseUrl()
    if (base) {
      try {
        const url = joinUrl(base, `tasks/${encodeURIComponent(taskId)}`)
        const response = await fetch(url, { method: 'GET' })
        if (response.ok) {
          const body = (await response.json()) as {
            data?: { task_detail?: InfTestTaskDetail }
            task_detail?: InfTestTaskDetail
          }
          const detail = body.data?.task_detail ?? body.task_detail
          if (detail) return detail
        }
      } catch {
        /* fall through to stub */
      }
    }
    return {
      task_id: taskId,
      task_target: '测试登录功能',
      task_config: {
        enable_case_generation: true,
        enable_device_manager: true,
        enable_test_execution: true,
        enable_result_analysis: true,
      },
    }
  }

  async reportTaskUpdate(
    update: TaskUpdate,
  ): Promise<ReportTaskUpdateResult> {
    const base = getProxyBaseUrl()
    if (!base) {
      return {
        accepted: true,
        event_id: update.event_id,
        task_id: update.task_id,
      }
    }

    const url = joinUrl(base, getTaskReportPath())
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(update),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(
        `Proxy task_report failed: ${response.status} ${text.slice(0, 200)}`,
      )
    }

    return {
      accepted: true,
      event_id: update.event_id,
      task_id: update.task_id,
    }
  }
}
