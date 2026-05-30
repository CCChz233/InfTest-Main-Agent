import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { expect, test } from 'bun:test'
import { ExecutionResultWatcher } from '../adapters/ExecutionResultWatcher.js'
import type { TaskUpdate } from '../schemas/update.js'

class MockProxyClient {
  updates: TaskUpdate[] = []

  async reportTaskUpdate(update: TaskUpdate): Promise<void> {
    this.updates.push(update)
  }
}

test('ExecutionResultWatcher reports colleague SUCCESS shape from case_result.json', async () => {
  const workspace = join('/tmp', `inftest-watcher-${Date.now()}`)
  const resultsDir = join(workspace, 'execution', 'results')
  mkdirSync(resultsDir, { recursive: true })
  writeFileSync(
    join(resultsDir, 'case_result.json'),
    JSON.stringify({
      task_id: 'exec-agent-test-001',
      case_id: 'case-1',
      status: 'pass',
      token_consumption: { total: { total_tokens: 42 } },
    }),
    'utf8',
  )

  const proxy = new MockProxyClient()
  const watcher = new ExecutionResultWatcher(proxy as never)
  const result = await watcher.watch({
    task_id: 'exec-agent-test-001',
    workspace,
    results_dir: resultsDir,
    summary_path: join(resultsDir, 'summary.json'),
    started_at_ms: Date.parse('2026-05-30T04:43:15Z'),
    ended_at_ms: Date.parse('2026-05-30T04:47:56Z'),
  })

  expect(result.reported_cases).toEqual(['case_result.json'])
  expect(proxy.updates.length).toBe(1)
  expect(proxy.updates[0]?.agent_name).toBe('test_executor')
  expect(proxy.updates[0]?.proxy_status).toBe('SUCCESS')
  expect(proxy.updates[0]?.step_log).toBe('Execution agent completed')
  expect(proxy.updates[0]?.output_json).toContain('"case_id":"case-1"')
})
