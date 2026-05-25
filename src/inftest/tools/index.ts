import type { Tools } from 'src/Tool.js'
import { ControlTaskTool } from './controlTask.js'
import { GetTaskDetailTool } from './getTaskDetail.js'
import { InitWorkspaceTool } from './initWorkspace.js'
import { InvokeSubagentTool } from './invokeSubagent.js'
import { ReadArtifactTool } from './readArtifact.js'
import { ReportTaskUpdateTool } from './reportTaskUpdate.js'
import { RunFakeE2ETool } from './runFakeE2E.js'
import { WatchExecutionResultsTool } from './watchExecutionResults.js'
import { WriteArtifactTool } from './writeArtifact.js'
import { WritePlanDagTool } from './writePlanDag.js'

export const InfTestTools: Tools = [
  GetTaskDetailTool,
  InitWorkspaceTool,
  WritePlanDagTool,
  InvokeSubagentTool,
  WatchExecutionResultsTool,
  ReportTaskUpdateTool,
  ControlTaskTool,
  ReadArtifactTool,
  WriteArtifactTool,
]

export const InfTestQueryTools: Tools = [RunFakeE2ETool]

export { RunFakeE2ETool }
