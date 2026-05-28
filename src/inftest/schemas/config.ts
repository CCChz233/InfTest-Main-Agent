import { z } from 'zod/v4'

export const InfTestProviderSchema = z.enum(['anthropic', 'openai'])

export const InfTestModelConfigSchema = z.strictObject({
  api_key: z.string().min(1).optional(),
  auth_token: z.string().min(1).optional(),
  base_url: z.string().url().optional(),
  name: z.string().min(1).optional(),
})

export const InfTestServerConfigSchema = z.strictObject({
  host: z.string().min(1).optional(),
  port: z.number().int().positive().optional(),
})

export const InfTestOrchestrationSchema = z.enum(['aggregate', 'stepwise'])

export const InfTestSubAgentLaunchSchema = z.strictObject({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
})

export const InfTestProxyConfigSchema = z.strictObject({
  base_url: z.string().url().optional(),
  task_report_path: z.string().min(1).optional(),
})

export const InfTestConfigSchema = z.strictObject({
  provider: InfTestProviderSchema.optional(),
  orchestration: InfTestOrchestrationSchema.optional(),
  runner: z.enum(['fake', 'query', 'available', 'stateful']).optional(),
  model: InfTestModelConfigSchema.optional(),
  server: InfTestServerConfigSchema.optional(),
  proxy: InfTestProxyConfigSchema.optional(),
  subagents: z.record(z.string(), InfTestSubAgentLaunchSchema).optional(),
  workspace_root: z.string().min(1).optional(),
  python_bin: z.string().min(1).optional(),
})

export type InfTestConfig = z.infer<typeof InfTestConfigSchema>
export type InfTestProvider = z.infer<typeof InfTestProviderSchema>
export type InfTestModelConfig = z.infer<typeof InfTestModelConfigSchema>
export type InfTestOrchestration = z.infer<typeof InfTestOrchestrationSchema>
export type InfTestSubAgentLaunch = z.infer<typeof InfTestSubAgentLaunchSchema>
