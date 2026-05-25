import { bootstrapInfTestHeadless } from '../src/inftest/headlessBootstrap.js'
import { hasInfTestModelCredentials } from '../src/inftest/config/credentials.js'
import { runInfTestApiE2E } from './inftest_api_e2e_lib.js'

bootstrapInfTestHeadless()

if (!hasInfTestModelCredentials()) {
  process.stderr.write(
    'Skip: no model credentials. Configure .inftest/config.json or ANTHROPIC_API_KEY / OPENAI_API_KEY.\n',
  )
  process.exit(2)
}

const { start, get } = await runInfTestApiE2E({ runner: 'query' })

if (get.run_fake_e2e_invoked !== true) {
  process.stderr.write(
    `Expected run_fake_e2e_invoked=true on GET /tasks/:id, got ${String(get.run_fake_e2e_invoked)}\n`,
  )
  process.exit(1)
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      runner: 'query',
      task_id: start.task_id,
      status: start.task_status,
      workspace: start.workspace,
      artifact_keys: Object.keys(start.artifacts),
      run_fake_e2e_invoked: get.run_fake_e2e_invoked,
    },
    null,
    2,
  )}\n`,
)
