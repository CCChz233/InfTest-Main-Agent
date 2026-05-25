import { readFileSync, existsSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { getInfTestConfig } from '../config/loadInfTestConfig.js'
import {
  parseSubAgentOutputJson,
  type SubAgentOutputJson,
} from '../schemas/subagentOutput.js'

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
)

export const SUBAGENT_NAMES = [
  'test_generation',
  'device_scheduler',
  'test_executor',
  'result_analyzer',
] as const

export type SubAgentName = (typeof SUBAGENT_NAMES)[number]

export type InvokeSubAgentInput = {
  agent_name: SubAgentName
  task_id: string
  workspace: string
  output_json: string
  timeout_seconds?: number
  extra_args?: Record<string, string | number | boolean>
}

export type InvokeSubAgentOutput = {
  success: boolean
  agent_name: SubAgentName
  output_json: string
  exit_code: number | null
  stdout_log: string
  stderr_log: string
  duration_ms: number
  error: string | null
  output?: SubAgentOutputJson
}

type RunningSubprocess = ReturnType<typeof Bun.spawn>

const AGENT_SCRIPTS: Record<SubAgentName, string> = {
  test_generation: 'mock_agents/fake_case_generation_agent.py',
  device_scheduler: 'mock_agents/fake_device_scheduler.py',
  test_executor: 'mock_agents/fake_execution_agent.py',
  result_analyzer: 'mock_agents/fake_result_analysis_agent.py',
}

const runningProcesses = new Map<string, RunningSubprocess>()

function processKey(taskId: string, agentName: SubAgentName): string {
  return `${taskId}:${agentName}`
}

export function getRunningSubAgentKeys(taskId?: string): string[] {
  const keys = [...runningProcesses.keys()].sort()
  if (!taskId) return keys
  return keys.filter(key => key.startsWith(`${taskId}:`))
}

export function terminateRunningSubAgents(
  taskId: string,
  agentName?: SubAgentName,
): string[] {
  const terminated: string[] = []
  for (const [key, proc] of runningProcesses.entries()) {
    if (!key.startsWith(`${taskId}:`)) continue
    if (agentName && key !== processKey(taskId, agentName)) continue
    proc.kill('SIGTERM')
    terminated.push(key)
  }
  return terminated
}

function buildSpawnArgv(
  input: InvokeSubAgentInput,
): { argv: string[]; cwd: string } {
  const cfg = getInfTestConfig()
  const override = cfg?.subagents?.[input.agent_name]
  const defaultScript = resolve(REPO_ROOT, AGENT_SCRIPTS[input.agent_name])
  const pythonBin = process.env.INFTEST_PYTHON_BIN ?? 'python3'

  const baseArgs = [
    '--task-id',
    input.task_id,
    '--workspace',
    input.workspace,
    '--output-json',
    input.output_json,
    ...extraArgsToArgv(input.extra_args),
  ]

  if (override?.command) {
    const prefix = override.args ?? []
    return {
      argv: [override.command, ...prefix, ...baseArgs],
      cwd: REPO_ROOT,
    }
  }

  if (!existsSync(defaultScript)) {
    return { argv: [], cwd: REPO_ROOT }
  }
  return {
    argv: [pythonBin, defaultScript, ...baseArgs],
    cwd: REPO_ROOT,
  }
}

function extraArgsToArgv(
  extraArgs: Record<string, string | number | boolean> | undefined,
): string[] {
  if (!extraArgs) return []
  const argv: string[] = []
  for (const [key, value] of Object.entries(extraArgs)) {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      throw new Error(`Invalid extra arg key: ${key}`)
    }
    const flag = `--${key.replaceAll('_', '-')}`
    if (typeof value === 'boolean') {
      if (value) argv.push(flag)
      continue
    }
    argv.push(flag, String(value))
  }
  return argv
}

async function readStream(
  stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
  if (!stream) return ''
  return new Response(stream).text()
}

function readValidatedOutput(
  outputPath: string,
  agentName: SubAgentName,
): {
  output: SubAgentOutputJson | undefined
  parseError: string | null
} {
  try {
    const raw = readFileSync(outputPath, 'utf8')
    const parsed = parseSubAgentOutputJson(raw)
    if (!parsed.ok) {
      return {
        output: undefined,
        parseError: `Invalid output-json: ${JSON.stringify(parsed.issues)}`,
      }
    }
    if (parsed.value.agent_name !== agentName) {
      return {
        output: parsed.value,
        parseError: `agent_name mismatch: expected ${agentName}, got ${parsed.value.agent_name}`,
      }
    }
    return { output: parsed.value, parseError: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { output: undefined, parseError: `Failed to read output-json: ${message}` }
  }
}

export class SubAgentAdapter {
  async invoke(input: InvokeSubAgentInput): Promise<InvokeSubAgentOutput> {
    const { argv, cwd } = buildSpawnArgv(input)
    if (argv.length === 0) {
      const script = resolve(REPO_ROOT, AGENT_SCRIPTS[input.agent_name])
      return {
        success: false,
        agent_name: input.agent_name,
        output_json: input.output_json,
        exit_code: null,
        stdout_log: '',
        stderr_log: '',
        duration_ms: 0,
        error: `Sub agent script not found: ${script}`,
      }
    }

    const startedAt = Date.now()
    const key = processKey(input.task_id, input.agent_name)
    const proc = Bun.spawn(argv, {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    runningProcesses.set(key, proc)

    let timedOut = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    if (input.timeout_seconds) {
      timeout = setTimeout(() => {
        timedOut = true
        proc.kill('SIGTERM')
      }, input.timeout_seconds * 1000)
    }

    try {
      const [exitCode, stdoutLog, stderrLog] = await Promise.all([
        proc.exited,
        readStream(proc.stdout),
        readStream(proc.stderr),
      ])

      const resolvedExit = timedOut ? 124 : exitCode
      const { output, parseError } = readValidatedOutput(
        input.output_json,
        input.agent_name,
      )

      const exitOk = resolvedExit === 0
      const outputOk = output ? output.success && output.status !== 'FAILED' : false
      const success = exitOk && !timedOut && parseError === null && outputOk

      let error: string | null = null
      if (timedOut) {
        error = `Sub agent timed out after ${input.timeout_seconds} seconds`
      } else if (parseError) {
        error = parseError
      } else if (!exitOk) {
        error =
          resolvedExit === 124
            ? 'Sub agent timed out (exit 124)'
            : `Sub agent exited with code ${resolvedExit}`
      } else if (output && !output.success) {
        error =
          output.error?.message ??
          `Sub agent reported failure (${output.status})`
      } else if (output && output.status === 'FAILED') {
        error = output.error?.message ?? 'Sub agent status FAILED'
      }

      return {
        success,
        agent_name: input.agent_name,
        output_json: input.output_json,
        exit_code: resolvedExit,
        stdout_log: stdoutLog,
        stderr_log: stderrLog,
        duration_ms: Date.now() - startedAt,
        error,
        output,
      }
    } finally {
      if (timeout) clearTimeout(timeout)
      runningProcesses.delete(key)
    }
  }
}
