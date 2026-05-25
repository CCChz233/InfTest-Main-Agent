import { QueryEngine } from '../src/QueryEngine.js'
import { buildInfTestSystemPrompt } from '../src/inftest/InfTestPrompt.js'
import { InfTestTools } from '../src/inftest/tools/index.js'
import { setSessionPersistenceDisabled } from '../src/bootstrap/state.js'
import { bootstrapInfTestHeadless } from '../src/inftest/headlessBootstrap.js'
import { getDefaultAppState } from '../src/state/AppStateStore.js'
import { createStore } from '../src/state/store.js'
import { createFileStateCacheWithSizeLimit } from '../src/utils/fileStateCache.js'

bootstrapInfTestHeadless()
setSessionPersistenceDisabled(true)

const appStore = createStore(getDefaultAppState())

const engine = new QueryEngine({
  cwd: process.cwd(),
  tools: InfTestTools,
  commands: [],
  mcpClients: [],
  agents: [],
  canUseTool: async (_tool, input, _context, _assistantMessage, _toolUseId, forceDecision) =>
    forceDecision ?? {
      behavior: 'allow',
      updatedInput: input,
    },
  getAppState: appStore.getState,
  setAppState: appStore.setState,
  readFileCache: createFileStateCacheWithSizeLimit(100),
  customSystemPrompt: buildInfTestSystemPrompt(),
  maxTurns: 6,
})

const prompt = [
  'Start InfTest task task-demo-001.',
  'Call get_task_detail first, then initialize the workspace',
  'and write a minimal PlanDAG.',
].join(' ')

for await (const message of engine.submitMessage(prompt)) {
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') {
        process.stdout.write(block.text)
      }
    }
  }
  if (message.type === 'result') {
    process.stdout.write(`\n\n[result] ${message.subtype}\n`)
    if ('result' in message && message.result) {
      process.stdout.write(`${message.result}\n`)
    }
  }
}
