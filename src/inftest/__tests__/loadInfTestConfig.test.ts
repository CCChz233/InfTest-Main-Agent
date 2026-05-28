import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  applyInfTestConfigToEnv,
  loadInfTestConfigFiles,
  resetInfTestConfigCacheForTests,
} from '../config/loadInfTestConfig.js'

const tmpRoot = join(process.cwd(), '.inftest-config-test-tmp')

afterEach(() => {
  resetInfTestConfigCacheForTests()
  rmSync(tmpRoot, { recursive: true, force: true })
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.INFTEST_RUNNER
  delete process.env.INFTEST_STATEFUL_RUNNER
  delete process.env.INFTEST_ORCHESTRATION
  delete process.env.INFTEST_CONFIG
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_KEY
  delete process.env.ANTHROPIC_MODEL
})

describe('loadInfTestConfig', () => {
  test('merges config.json and config.local.json', () => {
    const dir = join(tmpRoot, 'repo', '.inftest')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({
        runner: 'fake',
        model: { api_key: 'key-from-base' },
      }),
    )
    writeFileSync(
      join(dir, 'config.local.json'),
      JSON.stringify({
        runner: 'query',
        orchestration: 'stepwise',
        model: { name: 'claude-test' },
      }),
    )

    const config = loadInfTestConfigFiles(join(tmpRoot, 'repo'))
    expect(config?.runner).toBe('query')
    expect(config?.model?.api_key).toBe('key-from-base')
    expect(config?.orchestration).toBe('stepwise')
    expect(config?.model?.name).toBe('claude-test')
  })

  test('applyInfTestConfigToEnv does not override existing env', () => {
    process.env.ANTHROPIC_API_KEY = 'env-wins'
    applyInfTestConfigToEnv({
      model: { api_key: 'file-loses' },
      runner: 'query',
    })
    expect(process.env.ANTHROPIC_API_KEY).toBe('env-wins')
    expect(process.env.INFTEST_RUNNER).toBe('query')
  })

  test('accepts stateful runner config', () => {
    applyInfTestConfigToEnv({
      runner: 'stateful',
    })
    expect(process.env.INFTEST_RUNNER).toBe('stateful')
  })

  test('infers openai provider and normalizes chat/completions base URL', () => {
    applyInfTestConfigToEnv({
      model: {
        api_key: 'test-key',
        base_url: 'https://gateway.example/v1/chat/completions',
        name: 'deepseek-v4-pro',
      },
    })
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://gateway.example/v1')
    expect(process.env.OPENAI_API_KEY).toBe('test-key')
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined()
  })
})
