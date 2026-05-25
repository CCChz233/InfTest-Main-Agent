import { readdir, readFile } from 'fs/promises'
import { basename, join } from 'path'
import { ProxyClient } from './ProxyClient.js'

export type WatchExecutionResultsInput = {
  task_id: string
  results_dir: string
  summary_path: string
}

export type WatchExecutionResultsOutput = {
  task_id: string
  reported_cases: string[]
  summary_found: boolean
}

function parseJson(content: string): unknown {
  return JSON.parse(content) as unknown
}

export class ExecutionResultWatcher {
  constructor(private readonly proxyClient = new ProxyClient()) {}

  async watch(
    input: WatchExecutionResultsInput,
  ): Promise<WatchExecutionResultsOutput> {
    const entries = await readdir(input.results_dir).catch(() => [])
    const caseFiles = entries
      .filter(name => /^case_.*\.json$/.test(name))
      .sort()
    const reportedCases: string[] = []

    for (const file of caseFiles) {
      const path = join(input.results_dir, file)
      const content = await readFile(path, 'utf8').catch(() => null)
      if (content === null) continue
      reportedCases.push(file)
      await this.proxyClient.reportTaskUpdate({
        event_id: `${input.task_id}:case:${basename(file, '.json')}`,
        task_id: input.task_id,
        current_stage: 'EXECUTING',
        stage_operations: [],
        case_node_operations: [],
        case_detail_operations: [
          {
            path,
            content: parseJson(content),
          },
        ],
      })
    }

    const summaryContent = await readFile(input.summary_path, 'utf8').catch(
      () => null,
    )
    if (summaryContent !== null) {
      await this.proxyClient.reportTaskUpdate({
        event_id: `${input.task_id}:execution:summary`,
        task_id: input.task_id,
        current_stage: 'EXECUTING',
        stage_operations: [],
        case_node_operations: [],
        case_detail_operations: [
          {
            path: input.summary_path,
            content: parseJson(summaryContent),
          },
        ],
      })
    }

    return {
      task_id: input.task_id,
      reported_cases: reportedCases,
      summary_found: summaryContent !== null,
    }
  }
}
