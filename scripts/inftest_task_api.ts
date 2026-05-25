import { bootstrapInfTestHeadless } from '../src/inftest/headlessBootstrap.js'
import { startInfTestTaskApiServer } from '../src/inftest/server/taskApi.js'

bootstrapInfTestHeadless()

const server = startInfTestTaskApiServer()

process.stdout.write(
  `InfTest task API listening on http://${server.hostname}:${server.port}\n`,
)
