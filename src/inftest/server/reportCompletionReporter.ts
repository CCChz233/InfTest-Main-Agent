import { existsSync, readFileSync, readdirSync } from 'fs'
import { basename, join } from 'path'
import type { ProxyClient } from '../adapters/ProxyClient.js'
import { extractCaseResultRows } from './reportTaskLogFormat.js'

export type ReportDefectItem = {
  title: string
  description: string
  severity: string
  priority: string
  status: string
  remark: string
  related_cases: string[]
}

export type ReportDocxKind = 'functional' | 'integration' | 'smoke'

export type ReportDocxFile = {
  kind: ReportDocxKind
  path: string
  file_name: string
}

export type UploadedReportFile = {
  kind: ReportDocxKind
  path: string
  file_name: string
  file_key: string | null
}

const REPORT_DOCX_PREFIX_BY_KIND: Record<ReportDocxKind, string> = {
  functional: '功能测试报告_',
  integration: '集成测试报告_',
  smoke: '冒烟测试报告_',
}

const REPORT_DOCX_KIND_ORDER: ReportDocxKind[] = [
  'functional',
  'integration',
  'smoke',
]

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  return typeof value === 'string' ? value.trim() : ''
}

function isPassedFunctionalStatus(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
  return normalized === 'pass' || normalized === 'passed'
}

function isTrivialPassSummary(summary: string): boolean {
  const trimmed = summary.trim()
  return trimmed === '' || trimmed === '（通过）' || trimmed === '(通过)'
}

function mapRiskToSeverity(riskLevel: unknown): string {
  const normalized = String(riskLevel ?? '').trim().toLowerCase()
  if (normalized === 'high' || normalized === 'fatal') return 'FATAL'
  if (normalized === 'medium' || normalized === 'major') return 'MAJOR'
  if (normalized === 'low' || normalized === 'minor') return 'MINOR'
  return 'MAJOR'
}

function mapRiskToPriority(riskLevel: unknown): string {
  const normalized = String(riskLevel ?? '').trim().toLowerCase()
  if (normalized === 'high' || normalized === 'fatal') return 'P0'
  if (normalized === 'medium' || normalized === 'major') return 'P1'
  return 'P2'
}

function readJsonFile(path: string): unknown | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return null
  }
}

function walkFiles(root: string, matcher: (name: string) => boolean): string[] {
  const found: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (!dir || !existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile() && matcher(entry.name)) {
        found.push(full)
      }
    }
  }
  return found.sort()
}

function isExcludedReportDocx(name: string): boolean {
  return basename(name).startsWith('用例处理明细')
}

function kindForDocxBasename(name: string): ReportDocxKind | null {
  for (const kind of REPORT_DOCX_KIND_ORDER) {
    if (name.startsWith(REPORT_DOCX_PREFIX_BY_KIND[kind])) {
      return kind
    }
  }
  return null
}

export function resolvePlanIdFromWorkspace(
  workspace: string,
  taskId: string,
): string {
  const requestPath = join(workspace, 'input', 'task_report_generate_request.json')
  const payload = readJsonFile(requestPath)
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const planId = stringField(payload as Record<string, unknown>, 'plan_id')
    if (planId) return planId
  }
  const match = /^(.*)-task-\d+$/.exec(taskId)
  if (match?.[1]) return match[1]
  return taskId
}

export function buildCaseIdByIndex(workspace: string): Map<number, string> {
  const map = new Map<number, string>()
  const caseResultPath = join(workspace, 'execution', 'results', 'case_result.json')
  const payload = readJsonFile(caseResultPath)
  for (const row of extractCaseResultRows(payload)) {
    const index = Number(row.case_index)
    const caseId = stringField(row, 'case_id')
    if (Number.isFinite(index) && index > 0 && caseId) {
      map.set(Math.trunc(index), caseId)
    }
  }
  return map
}

export function loadReportAgentProblemAnalysis(
  workspace: string,
): Record<string, unknown> | null {
  const outputRoot = join(workspace, 'analysis', 'report_agent_output')
  const matches = walkFiles(
    outputRoot,
    name => name.startsWith('用例功能问题分析') && name.endsWith('.json'),
  )
  if (matches.length === 0) return null
  const payload = readJsonFile(matches[matches.length - 1]!)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  return payload as Record<string, unknown>
}

export function findReportDocxFiles(
  workspace: string,
  artifactHints?: Record<string, string>,
): ReportDocxFile[] {
  const byKind = new Map<ReportDocxKind, ReportDocxFile>()

  for (const kind of REPORT_DOCX_KIND_ORDER) {
    const hintKey = `analysis_report_docx_${kind}`
    const hinted = artifactHints?.[hintKey]?.trim()
    if (hinted && existsSync(hinted) && !isExcludedReportDocx(hinted)) {
      byKind.set(kind, {
        kind,
        path: hinted,
        file_name: basename(hinted),
      })
    }
  }

  const hintedPrimary = artifactHints?.analysis_report_docx?.trim()
  if (
    hintedPrimary &&
    existsSync(hintedPrimary) &&
    !isExcludedReportDocx(hintedPrimary)
  ) {
    const kind = kindForDocxBasename(basename(hintedPrimary))
    if (kind && !byKind.has(kind)) {
      byKind.set(kind, {
        kind,
        path: hintedPrimary,
        file_name: basename(hintedPrimary),
      })
    }
  }

  const outputRoot = join(workspace, 'analysis', 'report_agent_output')
  const docxFiles = walkFiles(outputRoot, name => name.endsWith('.docx')).filter(
    path => !isExcludedReportDocx(path),
  )

  for (const path of docxFiles) {
    const name = basename(path)
    const kind = kindForDocxBasename(name)
    if (!kind || byKind.has(kind)) continue
    byKind.set(kind, { kind, path, file_name: name })
  }

  return REPORT_DOCX_KIND_ORDER.flatMap(kind => {
    const item = byKind.get(kind)
    return item ? [item] : []
  })
}

export function findReportDocx(
  workspace: string,
  artifactHints?: Record<string, string>,
): string | null {
  const files = findReportDocxFiles(workspace, artifactHints)
  return (
    files.find(item => item.kind === 'functional')?.path ??
    files[0]?.path ??
    null
  )
}

function shouldIncludeProblemCase(row: Record<string, unknown>): boolean {
  if (!isPassedFunctionalStatus(row.functional_status)) return true
  const summary = stringField(row, 'functional_problem_summary')
  return summary !== '' && !isTrivialPassSummary(summary)
}

export function buildDefectListFromReportAgent(
  workspace: string,
): ReportDefectItem[] {
  const analysis = loadReportAgentProblemAnalysis(workspace)
  if (!analysis) return []

  const cases = analysis.cases
  if (!Array.isArray(cases)) return []

  const caseIdByIndex = buildCaseIdByIndex(workspace)
  const caseResultPath = join(workspace, 'execution', 'results', 'case_result.json')
  const caseRows = extractCaseResultRows(readJsonFile(caseResultPath))
  const riskByIndex = new Map<number, unknown>()
  for (const row of caseRows) {
    const index = Number(row.case_index)
    if (Number.isFinite(index) && index > 0) {
      riskByIndex.set(Math.trunc(index), row.risk_level)
    }
  }

  const defects: ReportDefectItem[] = []
  for (const item of cases) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    if (!shouldIncludeProblemCase(row)) continue

    const numericCaseId = Number(row.case_id)
    const caseIndex =
      Number.isFinite(numericCaseId) && numericCaseId > 0
        ? Math.trunc(numericCaseId)
        : defects.length + 1
    const relatedCaseId =
      caseIdByIndex.get(caseIndex) ??
      (Number.isFinite(numericCaseId) ? String(numericCaseId) : '')

    const title =
      stringField(row, 'functional_problem_summary') ||
      stringField(row, 'case_name') ||
      '测试缺陷'
    const description =
      stringField(row, 'failure_attribution_rationale') ||
      stringField(row, 'scenario_match_note') ||
      stringField(row, 'case_name')
    const riskLevel = riskByIndex.get(caseIndex)

    defects.push({
      title,
      description,
      severity: mapRiskToSeverity(riskLevel),
      priority: mapRiskToPriority(riskLevel),
      status: 'OPEN',
      remark: stringField(row, 'scenario_match_note'),
      related_cases: relatedCaseId ? [relatedCaseId] : [],
    })
  }
  return defects
}

export function buildReportCompletionOutputJson(
  defectList: ReportDefectItem[],
  extras?: Record<string, unknown>,
): string {
  return JSON.stringify({
    defect_list: defectList,
    ...(extras ?? {}),
  })
}

export function buildReportFilesOutputPayload(
  reportFiles: UploadedReportFile[],
): Record<string, unknown> {
  const uploaded = reportFiles.map(item => ({
    kind: item.kind,
    file_name: item.file_name,
    ...(item.file_key ? { file_key: item.file_key } : {}),
  }))
  const firstSuccess = reportFiles.find(item => item.file_key)
  return {
    report_files: uploaded,
    ...(firstSuccess?.file_key
      ? {
          report_file_key: firstSuccess.file_key,
          report_file_name: firstSuccess.file_name,
        }
      : {}),
  }
}

export type DeliverReportArtifactsResult = {
  docx_path: string | null
  file_name: string | null
  report_file_key: string | null
  report_files: UploadedReportFile[]
  output_json: string
  defect_list: ReportDefectItem[]
}

export async function deliverReportArtifacts(input: {
  task_id: string
  workspace: string
  proxy?: ProxyClient
  artifact_hints?: Record<string, string>
}): Promise<DeliverReportArtifactsResult> {
  const { ProxyClient } = await import('../adapters/ProxyClient.js')
  const proxy = input.proxy ?? new ProxyClient()
  const defectList = buildDefectListFromReportAgent(input.workspace)
  const docxFiles = findReportDocxFiles(input.workspace, input.artifact_hints)
  const planId = resolvePlanIdFromWorkspace(input.workspace, input.task_id)

  const reportFiles: UploadedReportFile[] = []
  for (const docx of docxFiles) {
    let fileKey: string | null = null
    try {
      const uploaded = await proxy.uploadAgentFile({
        task_id: input.task_id,
        plan_id: planId,
        file_path: docx.path,
        file_name: docx.file_name,
        file_type: 'analysis_report',
      })
      fileKey = uploaded.file_key
    } catch {
      fileKey = null
    }
    reportFiles.push({
      kind: docx.kind,
      path: docx.path,
      file_name: docx.file_name,
      file_key: fileKey,
    })
  }

  const firstSuccess =
    reportFiles.find(item => item.file_key) ?? reportFiles[0] ?? null
  const outputJson = buildReportCompletionOutputJson(
    defectList,
    buildReportFilesOutputPayload(reportFiles),
  )

  return {
    docx_path: firstSuccess?.path ?? null,
    file_name: firstSuccess?.file_name ?? null,
    report_file_key: firstSuccess?.file_key ?? null,
    report_files: reportFiles,
    output_json: outputJson,
    defect_list: defectList,
  }
}

function formatProxyTime(value: Date | string = new Date()): string {
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return String(value).trim()
  }
  return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export async function reportAnalysisRunningStatus(input: {
  task_id: string
  proxy?: ProxyClient
  step_log?: string
  started_at?: string
}): Promise<string> {
  const { ProxyClient } = await import('../adapters/ProxyClient.js')
  const proxy = input.proxy ?? new ProxyClient()
  const startedAt = formatProxyTime(input.started_at ?? new Date())
  try {
    await proxy.reportTaskUpdate({
      event_id: `${input.task_id}:reflecting:report-running`,
      task_id: input.task_id,
      agent_name: 'result_analyzer',
      proxy_status: 'RUNNING',
      task_status: 'RUNNING',
      current_stage: 'REFLECTING',
      output_json: '{}',
      step_log: input.step_log ?? 'Report generation started',
      start_time: startedAt,
      stage_operations: [],
      case_node_operations: [],
      case_detail_operations: [],
    })
  } catch {
    /* non-blocking */
  }
  return startedAt
}

export async function reportAnalysisFailedStatus(input: {
  task_id: string
  proxy?: ProxyClient
  step_log?: string
  started_at?: string
}): Promise<void> {
  const { ProxyClient } = await import('../adapters/ProxyClient.js')
  const proxy = input.proxy ?? new ProxyClient()
  const startedAt = formatProxyTime(input.started_at ?? new Date())
  const endedAt = formatProxyTime(new Date())
  try {
    await proxy.reportTaskUpdate({
      event_id: `${input.task_id}:reflecting:report-failed`,
      task_id: input.task_id,
      agent_name: 'result_analyzer',
      proxy_status: 'FAILED',
      task_status: 'FAILED',
      current_stage: 'REFLECTING',
      output_json: '{}',
      step_log: input.step_log ?? 'Report generation failed',
      start_time: startedAt,
      end_time: endedAt,
      stage_operations: [],
      case_node_operations: [],
      case_detail_operations: [],
    })
  } catch {
    /* non-blocking */
  }
}

export async function reportAnalysisCompletionStatus(input: {
  task_id: string
  workspace: string
  proxy?: ProxyClient
  artifact_hints?: Record<string, string>
  step_log?: string
  started_at?: string
}): Promise<DeliverReportArtifactsResult> {
  const { ProxyClient } = await import('../adapters/ProxyClient.js')
  const proxy = input.proxy ?? new ProxyClient()
  const delivered = await deliverReportArtifacts({
    task_id: input.task_id,
    workspace: input.workspace,
    proxy,
    artifact_hints: input.artifact_hints,
  })

  const endedAt = formatProxyTime(new Date())
  const startedAt = formatProxyTime(input.started_at ?? endedAt)
  try {
    await proxy.reportTaskUpdate({
      event_id: `${input.task_id}:reflecting:report-completion`,
      task_id: input.task_id,
      agent_name: 'result_analyzer',
      proxy_status: 'SUCCESS',
      task_status: 'SUCCESS',
      current_stage: 'REFLECTING',
      output_json: delivered.output_json,
      step_log: input.step_log ?? 'Report generation completed',
      start_time: startedAt,
      end_time: endedAt,
      stage_operations: [],
      case_node_operations: [],
      case_detail_operations: [],
    })
  } catch {
    /* non-blocking */
  }

  return delivered
}
