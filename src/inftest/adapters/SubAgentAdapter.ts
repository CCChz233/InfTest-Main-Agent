import { readFileSync, existsSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { getInfTestConfig } from '../config/loadInfTestConfig.js'
import { logEvent } from '../observability/logger.js'
import {
  parseSubAgentOutputJson,
  type SubAgentOutputJson,
} from '../schemas/subagentOutput.js'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

export const SUBAGENT_NAMES = [
  'test_generation',
  'device_scheduler',
  'test_executor',
  'result_analyzer',
] as const

export type SubAgentName = (typeof SUBAGENT_NAMES)[number]

const MAX_STEP_LOG_CHARS = 20_000

/**
 * Combines a sub-agent's stdout/stderr into a single execution log string for
 * the `step_log` field of the proxy task-status report. Output is trimmed to a
 * bounded size to keep status payloads reasonable.
 */
export function buildSubAgentStepLog(
  stdoutLog: string,
  stderrLog: string,
): string {
  const parts: string[] = []
  if (stdoutLog?.trim()) parts.push(stdoutLog.trim())
  if (stderrLog?.trim()) parts.push(`[stderr]\n${stderrLog.trim()}`)
  const combined = parts.join('\n')
  return combined.length > MAX_STEP_LOG_CHARS
    ? combined.slice(combined.length - MAX_STEP_LOG_CHARS)
    : combined
}

export type InvokeSubAgentInput = {
  agent_name: SubAgentName
  task_id: string
  workspace: string
  output_json: string
  timeout_seconds?: number
  extra_args?: Record<string, string | number | boolean>
  adapter_script?: string
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

type EnvLaunchOverride = {
  command: string
  args: string[]
  cwd: string
} | null

function processKey(taskId: string, agentName: SubAgentName): string {
  return `${taskId}:${agentName}`
}

function tokenizeArgs(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (Array.isArray(parsed)) {
        return parsed
          .filter(item => typeof item === 'string')
          .map(item => String(item))
      }
    } catch {
      return []
    }
  }
  const tokens = trimmed.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  return tokens.map(token => token.replace(/^['"]|['"]$/g, ''))
}

function resolveOverrideCwd(rawCwd: string | undefined): string {
  if (!rawCwd || rawCwd.trim() === '') return REPO_ROOT
  const trimmed = rawCwd.trim()
  return resolve(REPO_ROOT, trimmed)
}

function envOverrideForAgent(agentName: SubAgentName): EnvLaunchOverride {
  if (agentName === 'test_generation') {
    const command = process.env.INFTEST_TEST_GENERATION_AGENT_CMD?.trim()
    if (!command) return null
    const argsRaw = process.env.INFTEST_TEST_GENERATION_AGENT_ARGS ?? ''
    const cwd = resolveOverrideCwd(process.env.INFTEST_TEST_GENERATION_AGENT_CWD)
    return { command, args: tokenizeArgs(argsRaw), cwd }
  }
  if (agentName === 'device_scheduler') {
    const command = process.env.INFTEST_DEVICE_AGENT_CMD?.trim()
    if (!command) return null
    const argsRaw = process.env.INFTEST_DEVICE_AGENT_ARGS ?? ''
    const cwd = resolveOverrideCwd(process.env.INFTEST_DEVICE_AGENT_CWD)
    return { command, args: tokenizeArgs(argsRaw), cwd }
  }
  return null
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

function buildSpawnArgv(input: InvokeSubAgentInput): {
  argv: string[]
  cwd: string
} {
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

  const envOverride = envOverrideForAgent(input.agent_name)
  if (envOverride) {
    return {
      argv: [envOverride.command, ...envOverride.args, ...baseArgs],
      cwd: envOverride.cwd,
    }
  }

  if (input.adapter_script) {
    const script = resolve(REPO_ROOT, input.adapter_script)
    return {
      argv: [pythonBin, script, ...baseArgs],
      cwd: REPO_ROOT,
    }
  }

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

/**
 * Reads a subprocess stream incrementally, emitting each line to structured logs
 * so sub-agent output is visible in journalctl during long-running invocations.
 */
async function readStreamWithLogging(
  stream: ReadableStream<Uint8Array> | null,
  event: string,
  meta: Record<string, unknown>,
  channel: 'stdout' | 'stderr',
): Promise<string> {
  if (!stream) return ''
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let lineBuffer = ''
  let accumulated = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    accumulated += chunk
    lineBuffer += chunk
    let newlineIndex = lineBuffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = lineBuffer.slice(0, newlineIndex).trim()
      lineBuffer = lineBuffer.slice(newlineIndex + 1)
      if (line) {
        logEvent('info', event, { ...meta, channel, line })
      }
      newlineIndex = lineBuffer.indexOf('\n')
    }
  }
  const trailing = lineBuffer.trim()
  if (trailing) {
    logEvent('info', event, { ...meta, channel, line: trailing })
  }
  return accumulated
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
    return {
      output: undefined,
      parseError: `Failed to read output-json: ${message}`,
    }
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
    const logMeta = {
      task_id: input.task_id,
      agent_name: input.agent_name,
      cwd,
      output_json: input.output_json,
    }
    logEvent('info', 'subagent.invoke.start', {
      ...logMeta,
      cmd: argv.join(' '),
    })
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
        readStreamWithLogging(proc.stdout, 'subagent.stream', logMeta, 'stdout'),
        readStreamWithLogging(proc.stderr, 'subagent.stream', logMeta, 'stderr'),
      ])

      const resolvedExit = timedOut ? 124 : exitCode
      const { output, parseError } = readValidatedOutput(
        input.output_json,
        input.agent_name,
      )

      if (parseError) {
        logEvent('error', 'subagent.output_parse_failed', {
          task_id: input.task_id,
          agent_name: input.agent_name,
          output_json: input.output_json,
          error: parseError,
        })
      }

      const exitOk = resolvedExit === 0
      const outputOk = output
        ? output.success && output.status !== 'FAILED'
        : false
      const success = exitOk && !timedOut && parseError === null && outputOk

      let error: string | null = null
      if (timedOut) {
        error = `Sub agent timed out after ${input.timeout_seconds} seconds`
      } else if (parseError) {
        error = parseError
      } else if (output?.error?.message) {
        error = output.error.message
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

      logEvent(success ? 'info' : 'warn', 'subagent.invoke.finish', {
        ...logMeta,
        success,
        exit_code: resolvedExit,
        duration_ms: Date.now() - startedAt,
        error,
      })

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
