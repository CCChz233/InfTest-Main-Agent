type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function readLogLevel(): LogLevel {
  const raw = process.env.INFTEST_LOG_LEVEL?.trim().toLowerCase()
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw
  }
  return 'info'
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[readLogLevel()]
}

function jsonSafe(input: unknown): unknown {
  if (input instanceof Error) {
    return { name: input.name, message: input.message }
  }
  return input
}

export function logEvent(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (!shouldLog(level)) return
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, jsonSafe(v)]),
    ),
  }
  try {
    process.stdout.write(`${JSON.stringify(payload)}\n`)
  } catch {
    // Avoid affecting runtime flow if logging serialization fails.
  }
}

