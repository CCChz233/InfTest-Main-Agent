import {
  DEFAULT_INFTEST_AVAILABLE_AGENTS_TASK_ID,
  runInfTestAvailableAgentsE2E,
} from '../src/inftest/AvailableAgentsRunner.js'

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

const timeoutValue = readArg('--timeout-seconds')
const timeoutSeconds = timeoutValue ? Number(timeoutValue) : 120

const result = await runInfTestAvailableAgentsE2E({
  task_id: readArg('--task-id') ?? DEFAULT_INFTEST_AVAILABLE_AGENTS_TASK_ID,
  workspace_root: readArg('--workspace-root'),
  timeout_seconds: Number.isFinite(timeoutSeconds) ? timeoutSeconds : 120,
  device_id: readArg('--device-id'),
})

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
process.exitCode = result.status === 'SUCCESS' ? 0 : 1
