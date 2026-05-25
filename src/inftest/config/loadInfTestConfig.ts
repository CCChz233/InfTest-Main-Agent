import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join, resolve } from 'path'
import {
  InfTestConfigSchema,
  type InfTestConfig,
  type InfTestProvider,
} from '../schemas/config.js'

const DEFAULT_CONFIG_DIR = '.inftest'
const CONFIG_BASENAMES = ['config.json', 'config.local.json'] as const

let cachedConfig: InfTestConfig | null | undefined

function readJsonFile(path: string): unknown {
  const raw = readFileSync(path, 'utf8')
  return JSON.parse(raw) as unknown
}

function deepMergeConfig(
  base: InfTestConfig,
  overlay: InfTestConfig,
): InfTestConfig {
  return {
    ...base,
    ...overlay,
    model: overlay.model
      ? { ...base.model, ...overlay.model }
      : base.model,
    server: overlay.server
      ? { ...base.server, ...overlay.server }
      : base.server,
    proxy: overlay.proxy ? { ...base.proxy, ...overlay.proxy } : base.proxy,
    subagents: overlay.subagents
      ? { ...base.subagents, ...overlay.subagents }
      : base.subagents,
  }
}

function resolveConfigPaths(cwd: string): string[] {
  const explicit = process.env.INFTEST_CONFIG?.trim()
  if (explicit) {
    const path = isAbsolute(explicit) ? explicit : resolve(cwd, explicit)
    return existsSync(path) ? [path] : []
  }

  const paths: string[] = []
  for (const dir of [
    join(cwd, DEFAULT_CONFIG_DIR),
    join(homedir(), DEFAULT_CONFIG_DIR),
  ]) {
    for (const name of CONFIG_BASENAMES) {
      const path = join(dir, name)
      if (existsSync(path)) paths.push(path)
    }
  }
  return paths
}

function parseConfigFile(path: string): InfTestConfig {
  const parsed = InfTestConfigSchema.safeParse(readJsonFile(path))
  if (!parsed.success) {
    throw new Error(
      `Invalid InfTest config ${path}: ${JSON.stringify(parsed.error.issues)}`,
    )
  }
  return parsed.data
}

export function normalizeModelBaseUrl(
  baseUrl: string,
  provider: InfTestProvider,
): string {
  const trimmed = baseUrl.replace(/\/$/, '')
  if (provider === 'openai') {
    return trimmed.replace(/\/chat\/completions$/, '')
  }
  return trimmed
}

export function resolveInfTestProvider(config: InfTestConfig): InfTestProvider {
  if (config.provider) return config.provider
  if (config.model?.base_url?.includes('/chat/completions')) {
    return 'openai'
  }
  return 'anthropic'
}

export function loadInfTestConfigFiles(cwd = process.cwd()): InfTestConfig | null {
  const paths = resolveConfigPaths(cwd)
  if (paths.length === 0) return null

  let merged: InfTestConfig | null = null
  for (const path of paths) {
    const next = parseConfigFile(path)
    merged = merged ? deepMergeConfig(merged, next) : next
  }
  return merged
}

function setEnvIfUnset(key: string, value: string | undefined): void {
  if (value && process.env[key] === undefined) {
    process.env[key] = value
  }
}

export function applyInfTestConfigToEnv(config: InfTestConfig): void {
  const provider = resolveInfTestProvider(config)
  const apiKey = config.model?.api_key ?? config.model?.auth_token
  const baseUrl = config.model?.base_url
    ? normalizeModelBaseUrl(config.model.base_url, provider)
    : undefined

  if (provider === 'openai') {
    setEnvIfUnset('CLAUDE_CODE_USE_OPENAI', '1')
    if (apiKey) {
      setEnvIfUnset('OPENAI_API_KEY', apiKey)
    }
    if (baseUrl) {
      setEnvIfUnset('OPENAI_BASE_URL', baseUrl)
    }
  } else {
    if (config.model?.api_key) {
      setEnvIfUnset('ANTHROPIC_API_KEY', config.model.api_key)
    }
    if (config.model?.auth_token) {
      setEnvIfUnset('ANTHROPIC_AUTH_TOKEN', config.model.auth_token)
    }
    if (baseUrl) {
      setEnvIfUnset('ANTHROPIC_BASE_URL', baseUrl)
    }
  }

  if (config.model?.name) {
    setEnvIfUnset('INFTEST_MODEL', config.model.name)
    setEnvIfUnset('ANTHROPIC_MODEL', config.model.name)
  }
  if (config.runner) {
    setEnvIfUnset('INFTEST_RUNNER', config.runner)
  }
  if (config.orchestration) {
    setEnvIfUnset('INFTEST_ORCHESTRATION', config.orchestration)
  }
  if (config.server?.host) {
    setEnvIfUnset('INFTEST_HOST', config.server.host)
  }
  if (config.server?.port !== undefined) {
    setEnvIfUnset('INFTEST_PORT', String(config.server.port))
  }
  if (config.workspace_root) {
    setEnvIfUnset('INFTEST_WORKSPACE_ROOT', config.workspace_root)
  }
  if (config.python_bin) {
    setEnvIfUnset('INFTEST_PYTHON_BIN', config.python_bin)
  }
  if (config.proxy?.base_url) {
    setEnvIfUnset('INFTEST_PROXY_BASE_URL', config.proxy.base_url)
  }
  if (config.proxy?.task_report_path) {
    setEnvIfUnset('INFTEST_PROXY_TASK_REPORT_PATH', config.proxy.task_report_path)
  }
}

export function ensureInfTestConfigLoaded(cwd = process.cwd()): InfTestConfig | null {
  if (cachedConfig !== undefined) {
    return cachedConfig
  }
  const config = loadInfTestConfigFiles(cwd)
  if (config) {
    applyInfTestConfigToEnv(config)
  }
  cachedConfig = config
  return config
}

export function resetInfTestConfigCacheForTests(): void {
  cachedConfig = undefined
}

export function getInfTestConfig(): InfTestConfig | null {
  if (cachedConfig === undefined) {
    return ensureInfTestConfigLoaded()
  }
  return cachedConfig
}
