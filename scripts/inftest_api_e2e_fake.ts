import { runInfTestApiE2E } from './inftest_api_e2e_lib.js'

const { start, get } = await runInfTestApiE2E({ runner: 'fake' })

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      runner: 'fake',
      task_id: start.task_id,
      status: start.task_status,
      workspace: start.workspace,
      artifact_keys: Object.keys(start.artifacts),
      get_run_fake_e2e_invoked: get.run_fake_e2e_invoked ?? false,
    },
    null,
    2,
  )}\n`,
)
