import type { InfTestTaskDetail } from '../schemas/task.js'
import type { TaskUpdate } from '../schemas/update.js'
import { existsSync, readFileSync } from 'fs'
import { readFile } from 'fs/promises'
import { join, resolve } from 'path'
import { logEvent } from '../observability/logger.js'
import { buildUpdateTaskStatusPayload } from './updateTaskStatusPayload.js'

export type ReportTaskUpdateResult = {
  accepted: true
  event_id: string
  exec_id: string
  task_id: string
}

export type GeneratedTaskInfo = {
  task_id: string
  task_name: string
  task_type: string
}

export type PlanDetailInfo = {
  test_objectives: string
  test_scope: string
  test_target: string
  test_environment: string
  resources: string
  schedule: string
  deliverables: string
}

export type ReportTestPlanDetailResult = {
  accepted: true
  plan_id: string
}

export type UploadAgentFileResult = {
  accepted: true
  file_key: string
  path: string
}

export type ReportPlanFinalStatusResult = {
  accepted: true
  plan_id: string
  task_id: string
  task_status: string
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
    process.env.INFTEST_PROXY_TASK_REPORT_PATH?.trim() ??
    'api/proxy-update-task-status'
  )
}

function getPlanTaskSubmitPath(): string {
  return (
    process.env.INFTEST_PROXY_PLAN_TASK_SUBMIT_PATH?.trim() ??
    'api/proxy-plan-task-submit'
  )
}

function getFileUploadPath(): string {
  return (
    process.env.INFTEST_PROXY_FILE_UPLOAD_PATH?.trim() ??
    'api/proxy-files/agent/upload'
  )
}

function getPlanFinalReportPath(): string {
  return (
    process.env.INFTEST_PROXY_PLAN_FINAL_REPORT_PATH?.trim() ??
    'api/proxy-test-plans/report-detail'
  )
}

function readBooleanEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function isStrictRealMode(): boolean {
  return readBooleanEnv('INFTEST_REAL_ONLY')
}

function getWorkspaceRoot(): string {
  const configured = process.env.INFTEST_WORKSPACE_ROOT?.trim()
  return configured ? resolve(configured) : resolve(process.cwd(), '.inftest-workspace')
}

/**
 * Reads a locally persisted task_detail (written by the planner real handler
 * from real platform-provided plan data, or by a prior PlanSkill run). This
 * lets PLANNING proceed using real data even when the upstream task-detail
 * endpoint is temporarily unreachable, without fabricating a generic stub.
 */
function readLocalTaskDetail(taskId: string): InfTestTaskDetail | null {
  if (!/^[A-Za-z0-9._-]+$/.test(taskId)) return null
  const path = join(getWorkspaceRoot(), taskId, 'input', 'task_detail.json')
  if (!existsSync(path)) return null
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const target =
      typeof data.task_target === 'string' && data.task_target.trim()
        ? data.task_target.trim()
        : null
    if (!target) return null
    const cfg = (data.task_config ?? {}) as Record<string, unknown>
    return {
      exec_id: typeof data.exec_id === 'string' ? data.exec_id : taskId,
      task_id: typeof data.task_id === 'string' ? data.task_id : taskId,
      task_target: target,
      task_config: {
        enable_case_generation: cfg.enable_case_generation !== false,
        enable_device_manager: cfg.enable_device_manager !== false,
        enable_test_execution: cfg.enable_test_execution !== false,
        enable_result_analysis: cfg.enable_result_analysis !== false,
      },
    }
  } catch {
    return null
  }
}

export class ProxyClient {
  async getTaskDetail(taskId: string): Promise<InfTestTaskDetail> {
    const base = getProxyBaseUrl()
    if (base) {
      try {
        const url = joinUrl(base, `tasks/${encodeURIComponent(taskId)}`)
        const startedAt = Date.now()
        const response = await fetch(url, { method: 'GET' })
        logEvent('info', 'proxy.get_task_detail', {
          task_id: taskId,
          url,
          status: response.status,
          latency_ms: Date.now() - startedAt,
        })
        if (response.ok) {
          const body = (await response.json()) as {
            data?: { task_detail?: Record<string, unknown> }
            task_detail?: Record<string, unknown>
          }
          const detail = body.data?.task_detail ?? body.task_detail
          const execId =
            typeof detail?.exec_id === 'string'
              ? detail.exec_id
              : typeof detail?.task_id === 'string'
                ? detail.task_id
                : taskId
          if (detail) {
            return {
              ...detail,
              exec_id: execId,
              task_id:
                typeof detail.task_id === 'string' ? detail.task_id : execId,
            } as InfTestTaskDetail
          }
        }
      } catch {
        /* fall through to stub */
      }
    }
    const localDetail = readLocalTaskDetail(taskId)
    if (localDetail) {
      logEvent('info', 'proxy.get_task_detail.local', { task_id: taskId })
      return localDetail
    }
    const reason = base
      ? 'proxy_unavailable_or_invalid_response'
      : 'proxy_base_url_missing'
    if (isStrictRealMode()) {
      throw new Error(
        `Proxy get_task_detail failed for ${taskId}: ${reason}. Set INFTEST_PROXY_BASE_URL and ensure downstream API is reachable.`,
      )
    }
    logEvent('warn', 'proxy.get_task_detail.fallback_stub', {
      task_id: taskId,
      reason,
    })
    return {
      exec_id: taskId,
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

  async reportTaskUpdate(update: TaskUpdate): Promise<ReportTaskUpdateResult> {
    const base = getProxyBaseUrl()
    if (!base) {
      if (isStrictRealMode()) {
        throw new Error(
          'Proxy task_report failed: proxy_base_url_missing in strict real mode',
        )
      }
      logEvent('warn', 'proxy.report_task_update.skipped', {
        task_id: update.task_id,
        reason: 'proxy_base_url_missing',
      })
      return {
        accepted: true,
        event_id: update.event_id,
        exec_id: update.exec_id ?? update.task_id,
        task_id: update.task_id,
      }
    }

    const url = joinUrl(base, getTaskReportPath())
    const payload = buildUpdateTaskStatusPayload(update)
    const startedAt = Date.now()
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    })
    logEvent('info', 'proxy.report_task_update', {
      task_id: update.task_id,
      agent_name: payload.agent_name,
      agent_status: payload.agent_status,
      payload,
      url,
      status: response.status,
      latency_ms: Date.now() - startedAt,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      logEvent('error', 'proxy.report_task_update.failed', {
        task_id: update.task_id,
        url,
        status: response.status,
        response_snippet: text.slice(0, 200),
      })
      throw new Error(
        `Proxy task_report failed: ${response.status} ${text.slice(0, 200)}`,
      )
    }

    return {
      accepted: true,
      event_id: update.event_id,
      exec_id: update.exec_id ?? update.task_id,
      task_id: update.task_id,
    }
  }

  async reportGeneratedTasks(input: {
    plan_id: string
    tasks: GeneratedTaskInfo[]
    request_id?: string
  }): Promise<{ accepted: true; plan_id: string; task_count: number }> {
    const base = getProxyBaseUrl()
    if (!base) {
      if (isStrictRealMode()) {
        throw new Error(
          'Proxy plan-task-submit failed: proxy_base_url_missing in strict real mode',
        )
      }
      logEvent('warn', 'proxy.report_generated_tasks.skipped', {
        plan_id: input.plan_id,
        reason: 'proxy_base_url_missing',
      })
      return {
        accepted: true,
        plan_id: input.plan_id,
        task_count: input.tasks.length,
      }
    }

    const url = joinUrl(base, getPlanTaskSubmitPath())
    const startedAt = Date.now()
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(input),
    })
    logEvent('info', 'proxy.report_generated_tasks', {
      plan_id: input.plan_id,
      task_count: input.tasks.length,
      url,
      status: response.status,
      latency_ms: Date.now() - startedAt,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      logEvent('error', 'proxy.report_generated_tasks.failed', {
        plan_id: input.plan_id,
        url,
        status: response.status,
        response_snippet: text.slice(0, 200),
      })
      throw new Error(
        `Proxy plan-task-submit failed: ${response.status} ${text.slice(0, 200)}`,
      )
    }

    return {
      accepted: true,
      plan_id: input.plan_id,
      task_count: input.tasks.length,
    }
  }

  async reportTestPlanDetail(input: {
    plan_id: string
    plan_detail: PlanDetailInfo
    failure_reason: string
  }): Promise<ReportTestPlanDetailResult> {
    const base = getProxyBaseUrl()
    if (!base) {
      if (isStrictRealMode()) {
        throw new Error(
          'Proxy plan detail report failed: proxy_base_url_missing in strict real mode',
        )
      }
      logEvent('warn', 'proxy.report_test_plan_detail.skipped', {
        plan_id: input.plan_id,
        reason: 'proxy_base_url_missing',
      })
      return {
        accepted: true,
        plan_id: input.plan_id,
      }
    }

    const url = joinUrl(base, getPlanTaskSubmitPath())
    const startedAt = Date.now()
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(input),
    })
    logEvent('info', 'proxy.report_test_plan_detail', {
      plan_id: input.plan_id,
      url,
      status: response.status,
      latency_ms: Date.now() - startedAt,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      logEvent('error', 'proxy.report_test_plan_detail.failed', {
        plan_id: input.plan_id,
        url,
        status: response.status,
        response_snippet: text.slice(0, 200),
      })
      throw new Error(
        `Proxy plan detail report failed: ${response.status} ${text.slice(0, 200)}`,
      )
    }
    return {
      accepted: true,
      plan_id: input.plan_id,
    }
  }

  async uploadAgentFile(input: {
    task_id: string
    plan_id?: string
    file_path: string
    file_name?: string
    file_type?: string
  }): Promise<UploadAgentFileResult> {
    const base = getProxyBaseUrl()
    if (!base) {
      if (isStrictRealMode()) {
        throw new Error(
          'Proxy file upload failed: proxy_base_url_missing in strict real mode',
        )
      }
      logEvent('warn', 'proxy.upload_agent_file.skipped', {
        task_id: input.task_id,
        file_path: input.file_path,
        reason: 'proxy_base_url_missing',
      })
      return {
        accepted: true,
        file_key: input.file_path,
        path: input.file_path,
      }
    }
    const fileBuffer = await readFile(input.file_path)
    const fileName =
      input.file_name?.trim() ||
      input.file_path.split('/').pop() ||
      'artifact.bin'
    const form = new FormData()
    form.set('task_id', input.task_id)
    if (input.plan_id) form.set('plan_id', input.plan_id)
    if (input.file_type) form.set('file_type', input.file_type)
    form.set('file_name', fileName)
    form.set('file', new Blob([fileBuffer]), fileName)

    const url = joinUrl(base, getFileUploadPath())
    const startedAt = Date.now()
    const response = await fetch(url, {
      method: 'POST',
      body: form,
    })
    logEvent('info', 'proxy.upload_agent_file', {
      task_id: input.task_id,
      plan_id: input.plan_id,
      url,
      status: response.status,
      file_name: fileName,
      latency_ms: Date.now() - startedAt,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      logEvent('error', 'proxy.upload_agent_file.failed', {
        task_id: input.task_id,
        url,
        status: response.status,
        response_snippet: text.slice(0, 200),
      })
      throw new Error(
        `Proxy file upload failed: ${response.status} ${text.slice(0, 200)}`,
      )
    }
    const responseBody = (await response.json().catch(() => ({}))) as {
      data?: { file_key?: string; path?: string }
      file_key?: string
      path?: string
    }
    return {
      accepted: true,
      file_key:
        responseBody.data?.file_key ??
        responseBody.file_key ??
        input.file_path,
      path: responseBody.data?.path ?? responseBody.path ?? input.file_path,
    }
  }

  async reportPlanFinalStatus(input: {
    plan_id: string
    task_id: string
    task_status: string
    report_file_key?: string
    message?: string
  }): Promise<ReportPlanFinalStatusResult> {
    const base = getProxyBaseUrl()
    if (!base) {
      if (isStrictRealMode()) {
        throw new Error(
          'Proxy plan final report failed: proxy_base_url_missing in strict real mode',
        )
      }
      logEvent('warn', 'proxy.report_plan_final_status.skipped', {
        plan_id: input.plan_id,
        task_id: input.task_id,
        reason: 'proxy_base_url_missing',
      })
      return {
        accepted: true,
        plan_id: input.plan_id,
        task_id: input.task_id,
        task_status: input.task_status,
      }
    }

    const url = joinUrl(base, getPlanFinalReportPath())
    const startedAt = Date.now()
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(input),
    })
    logEvent('info', 'proxy.report_plan_final_status', {
      plan_id: input.plan_id,
      task_id: input.task_id,
      task_status: input.task_status,
      url,
      status: response.status,
      latency_ms: Date.now() - startedAt,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      logEvent('error', 'proxy.report_plan_final_status.failed', {
        plan_id: input.plan_id,
        task_id: input.task_id,
        url,
        status: response.status,
        response_snippet: text.slice(0, 200),
      })
      throw new Error(
        `Proxy plan final report failed: ${response.status} ${text.slice(0, 200)}`,
      )
    }
    return {
      accepted: true,
      plan_id: input.plan_id,
      task_id: input.task_id,
      task_status: input.task_status,
    }
  }
}
