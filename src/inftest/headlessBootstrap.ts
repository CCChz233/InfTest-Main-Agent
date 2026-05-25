import { enableConfigs } from 'src/utils/config.js'
import { applyConfigEnvironmentVariables } from 'src/utils/managedEnv.js'
import { ensureInfTestConfigLoaded } from './config/loadInfTestConfig.js'

let bootstrapped = false

function ensureMacroDefines(): void {
  if (typeof globalThis.MACRO !== 'undefined') return
  ;(globalThis as { MACRO: Record<string, string> }).MACRO = {
    VERSION: process.env.CLAUDE_CODE_VERSION || '2.1.888',
    BUILD_TIME: new Date().toISOString(),
    FEEDBACK_CHANNEL: '',
    ISSUES_EXPLAINER: '',
    NATIVE_PACKAGE_URL: '',
    PACKAGE_URL: '',
    VERSION_CHANGELOG: '',
  }
}

/**
 * Minimal headless bootstrap for InfTest query mode.
 * Loads `.inftest/config.json` into env (without overriding existing env),
 * then mirrors print-mode trust: config enabled + full env vars.
 */
export function bootstrapInfTestHeadless(): void {
  if (bootstrapped) return
  ensureMacroDefines()
  ensureInfTestConfigLoaded()
  enableConfigs()
  applyConfigEnvironmentVariables()
  bootstrapped = true
}
