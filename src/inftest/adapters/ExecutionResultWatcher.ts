import { readFile } from 'fs/promises'
import { join } from 'path'
import {
  buildExecutionStatusReportFromCaseResultJson,
  loadExecutionStatusReport,
} from './executionStatusReport.js'
import { logEvent } from '../observability/logger.js'
import type { TaskUpdate } from '../schemas/update.js'
import { ProxyClient } from './ProxyClient.js'

export type WatchExecutionResultsInput = {
  task_id: string
  results_dir: string
  summary_path: string
  workspace?: string
  started_at_ms?: number
  ended_at_ms?: number
}

export type WatchExecutionResultsOutput = {
  task_id: string
  reported_cases: string[]
  summary_found: boolean
}

const COLLEAGUE_EXECUTION_SUCCESS_STEP_LOG = 'Execution agent completed'

function buildColleagueExecutionSuccessUpdate(
  input: WatchExecutionResultsInput,
  report: { output_json: string; total_tokens: number; step_log: string },
): TaskUpdate {
  const startedAt = input.started_at_ms ?? Date.now()
  const endedAt = input.ended_at_ms ?? Date.now()
  return {
    event_id: `${input.task_id}:execution:case_result`,
    task_id: input.task_id,
    current_stage: 'EXECUTING',
    agent_name: 'test_executor',
    task_status: 'SUCCESS',
    proxy_status: 'SUCCESS',
    total_tokens: report.total_tokens,
    output_json: report.output_json,
    step_log: report.step_log,
    start_time: new Date(startedAt).toISOString(),
    end_time: new Date(endedAt).toISOString(),
    stage_operations: [],
    case_node_operations: [],
    case_detail_operations: [],
  }
}

/**
 * Reports execution completion in colleague proxy-update-task-status shape:
 * agent_name=4, agent_status=3 (SUCCESS), output_json=compact case_result, step_log fixed phrase.
 */
export class ExecutionResultWatcher {
  constructor(private readonly proxyClient = new ProxyClient()) {}

  async watch(
    input: WatchExecutionResultsInput,
  ): Promise<WatchExecutionResultsOutput> {
    const workspace =
      input.workspace ?? join(input.results_dir, '..', '..')
    const caseResultPath = join(input.results_dir, 'case_result.json')

    let report = await loadExecutionStatusReport(workspace)
    if (!report) {
      try {
        const raw = await readFile(caseResultPath, 'utf8')
        report = buildExecutionStatusReportFromCaseResultJson(
          raw,
          COLLEAGUE_EXECUTION_SUCCESS_STEP_LOG,
        )
      } catch {
        report = null
      }
    }

    const summaryContent = await readFile(input.summary_path, 'utf8').catch(
      () => null,
    )

    if (!report) {
      return {
        task_id: input.task_id,
        reported_cases: [],
        summary_found: summaryContent !== null,
      }
    }

    const update = buildColleagueExecutionSuccessUpdate(input, report)
    try {
      await this.proxyClient.reportTaskUpdate(update)
    } catch (error) {
      logEvent('warn', 'execution_result_watcher.case_report.failed', {
        task_id: input.task_id,
        path: caseResultPath,
        error,
      })
    }

    return {
      task_id: input.task_id,
      reported_cases: ['case_result.json'],
      summary_found: summaryContent !== null,
    }
  }
}
