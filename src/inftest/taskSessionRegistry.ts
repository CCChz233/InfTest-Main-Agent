import type { TaskSessionManager } from './TaskSessionManager.js'

let registered: TaskSessionManager | null = null

export function registerInfTestSessionManager(manager: TaskSessionManager): void {
  registered = manager
}

export function getRegisteredInfTestSessionManager(): TaskSessionManager | null {
  return registered
}

/** @internal test-only */
export function resetInfTestSessionRegistryForTests(): void {
  registered = null
}
