import { isAnthropicAuthEnabled } from 'src/utils/auth.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'

export function hasInfTestModelCredentials(): boolean {
  if (isAnthropicAuthEnabled()) return true
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    return true
  }
  if (process.env.OPENAI_API_KEY) return true
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI) && process.env.OPENAI_API_KEY) {
    return true
  }
  return false
}
