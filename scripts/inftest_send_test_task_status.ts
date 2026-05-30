import { ProxyClient } from '../src/inftest/adapters/ProxyClient.js'

// One-off helper: sends a representative UpdateTaskStatusRequest report to the
// agent proxy via the exact production ProxyClient + payload builder, so we can
// confirm the proxy receives the new agent_status payload. Run with the
// production env loaded so INFTEST_PROXY_BASE_URL / path are applied.
async function main(): Promise<void> {
  const proxy = new ProxyClient()
  const taskId = process.argv[2] ?? `verify-${Date.now()}`
  const now = Date.now()

  const result = await proxy.reportTaskUpdate({
    event_id: `${taskId}:verify:running`,
    task_id: taskId,
    agent_name: 'test_generation',
    task_status: 'RUNNING',
    total_tokens: 0,
    output_json: JSON.stringify({ note: 'manual verification report' }),
    step_log: 'manual verification: case generation started',
    start_time: new Date(now).toISOString(),
    end_time: new Date(now + 1234).toISOString(),
    stage_operations: [],
    case_node_operations: [],
    case_detail_operations: [],
  })

  process.stdout.write(`${JSON.stringify(result)}\n`)
}

main().catch(error => {
  process.stderr.write(
    `report failed: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(1)
})
