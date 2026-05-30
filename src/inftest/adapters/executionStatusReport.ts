import { readFile } from 'fs/promises'
import { join } from 'path'

/** Colleague proxy-update-task-status example: compact case_result JSON in output_json. */
export type ExecutionStatusReportPayload = {
  output_json: string
  total_tokens: number
  step_log: string
}

export function compactJsonString(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw) as unknown)
  } catch {
    return raw.trim()
  }
}

export function extractTotalTokensFromCaseResult(
  data: Record<string, unknown>,
): number {
  const consumption = data.token_consumption
  if (!consumption || typeof consumption !== 'object' || Array.isArray(consumption)) {
    return 0
  }
  const total = (consumption as Record<string, unknown>).total
  if (!total || typeof total !== 'object' || Array.isArray(total)) return 0
  const tokens = (total as Record<string, unknown>).total_tokens
  return typeof tokens === 'number' && tokens >= 0 ? tokens : 0
}

export function buildExecutionStatusReportFromCaseResultJson(
  caseResultJson: string,
  stepLog = 'Execution agent completed',
): ExecutionStatusReportPayload {
  let totalTokens = 0
  try {
    const parsed = JSON.parse(caseResultJson) as Record<string, unknown>
    totalTokens = extractTotalTokensFromCaseResult(parsed)
  } catch {
    /* keep defaults */
  }
  return {
    output_json: compactJsonString(caseResultJson),
    total_tokens: totalTokens,
    step_log: stepLog,
  }
}

export async function loadExecutionStatusReport(
  workspace: string,
  caseResultRelPath = join('execution', 'results', 'case_result.json'),
): Promise<ExecutionStatusReportPayload | null> {
  const path = join(workspace, caseResultRelPath)
  try {
    const raw = await readFile(path, 'utf8')
    return buildExecutionStatusReportFromCaseResultJson(raw)
  } catch {
    return null
  }
}
