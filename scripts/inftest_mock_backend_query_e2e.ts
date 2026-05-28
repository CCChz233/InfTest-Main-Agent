import { hasInfTestModelCredentials } from '../src/inftest/config/credentials.js'
import { bootstrapInfTestHeadless } from '../src/inftest/headlessBootstrap.js'
import { startInfTestTaskApiServer } from '../src/inftest/server/taskApi.js'
import { startInfTestMockBackendApiServer } from './inftest_mock_backend_api.js'

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

type ApiEnvelope<T = unknown> = {
  code: number
  message: string
  data?: T
}

const taskId = readArg('--task-id') ?? 'task-port-query-001'
const agentPort = Number(readArg('--agent-port') ?? process.env.INFTEST_PORT ?? 18787)
const backendPort = Number(
  readArg('--backend-port') ?? process.env.INFTEST_MOCK_BACKEND_PORT ?? 18790,
)

process.env.INFTEST_RUNNER = 'query'
process.env.INFTEST_ORCHESTRATION = 'stepwise'
process.env.INFTEST_PORT = String(agentPort)
process.env.INFTEST_MOCK_BACKEND_PORT = String(backendPort)
process.env.INFTEST_AGENT_BASE_URL = `http://127.0.0.1:${agentPort}`
process.env.INFTEST_PROXY_BASE_URL = `http://127.0.0.1:${backendPort}`
process.env.INFTEST_PROXY_TASK_REPORT_PATH =
  process.env.INFTEST_PROXY_TASK_REPORT_PATH ?? 'api/tasks/update'

bootstrapInfTestHeadless()

if (!hasInfTestModelCredentials()) {
  process.stderr.write(
    'Skip: no model credentials. Configure .inftest/config.json or ANTHROPIC_API_KEY / OPENAI_API_KEY.\n',
  )
  process.exit(2)
}

const agentServer = startInfTestTaskApiServer({
  hostname: '127.0.0.1',
  port: agentPort,
})
const backendServer = startInfTestMockBackendApiServer()

try {
  const backendBase = `http://127.0.0.1:${backendPort}`
  const startResponse = await fetch(`${backendBase}/api/tasks/alter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      task_id: taskId,
      task_operation: 'START',
      task_target:
        '用户通过 mock 后端端口启动任务：请按 InfTest 主 Agent 工具链生成计划、调用子 Agent、上报状态并产出报告。',
    }),
  })
  const startBody = (await startResponse.json()) as ApiEnvelope
  if (!startResponse.ok || startBody.code !== 0) {
    throw new Error(
      `POST /api/tasks/alter failed: ${startResponse.status} ${JSON.stringify(startBody)}`,
    )
  }

  const detailResponse = await fetch(
    `${backendBase}/api/mock/tasks/${encodeURIComponent(taskId)}`,
  )
  const detailBody = (await detailResponse.json()) as ApiEnvelope<Record<string, unknown>>
  if (!detailResponse.ok || detailBody.code !== 0 || !detailBody.data) {
    throw new Error(
      `GET /api/mock/tasks/:id failed: ${detailResponse.status} ${JSON.stringify(detailBody)}`,
    )
  }

  const task = detailBody.data
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        mode: 'mock-backend + query + stepwise',
        task_id: taskId,
        task_status: task.task_status,
        agent_port: agentPort,
        backend_port: backendPort,
        update_count: Array.isArray(task.updates) ? task.updates.length : 0,
        upload_count: Array.isArray(task.uploads) ? task.uploads.length : 0,
        start_response: startBody.data,
      },
      null,
      2,
    )}\n`,
  )

  if (task.task_status !== 'SUCCESS') {
    process.exitCode = 1
  }
} finally {
  backendServer.stop()
  agentServer.stop()
}
