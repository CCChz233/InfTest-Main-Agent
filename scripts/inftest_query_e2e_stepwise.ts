import { bootstrapInfTestHeadless } from '../src/inftest/headlessBootstrap.js'
import { hasInfTestModelCredentials } from '../src/inftest/config/credentials.js'
import { InfTestStepwiseQueryRunner } from '../src/inftest/InfTestStepwiseQueryRunner.js'
import { setSessionPersistenceDisabled } from '../src/bootstrap/state.js'

bootstrapInfTestHeadless()
setSessionPersistenceDisabled(true)

if (!hasInfTestModelCredentials()) {
  process.stderr.write(
    'Skip: no model credentials. Configure .inftest/config.json or ANTHROPIC_API_KEY / OPENAI_API_KEY.\n',
  )
  process.exit(2)
}

process.env.INFTEST_ORCHESTRATION = 'stepwise'

const taskId = process.argv[2] ?? 'task-demo-001'
const result = await new InfTestStepwiseQueryRunner().runTask(taskId)

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
process.exit(result.status === 'SUCCESS' ? 0 : 1)
