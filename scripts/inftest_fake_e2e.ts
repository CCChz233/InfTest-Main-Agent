import {
  DEFAULT_INFTEST_FAKE_TASK_ID,
  runInfTestFakeE2E,
} from '../src/inftest/FakeE2ERunner.js'

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

const timeoutValue = readArg('--timeout-seconds')
const timeoutSeconds = timeoutValue ? Number(timeoutValue) : 30

const result = await runInfTestFakeE2E({
  task_id: readArg('--task-id') ?? DEFAULT_INFTEST_FAKE_TASK_ID,
  workspace_root: readArg('--workspace-root'),
  timeout_seconds: Number.isFinite(timeoutSeconds) ? timeoutSeconds : 30,
})

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
process.exitCode = result.status === 'SUCCESS' ? 0 : 1
