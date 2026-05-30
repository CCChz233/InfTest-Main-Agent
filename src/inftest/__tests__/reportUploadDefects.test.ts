import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { afterEach, expect, test } from 'bun:test'
import { ProxyClient } from '../adapters/ProxyClient.js'
import { buildUpdateTaskStatusPayload } from '../adapters/updateTaskStatusPayload.js'
import { reportPlanFinalStatusWithUpload } from '../planFinalReporter.js'
import { ReportSkill } from '../skills/ReportSkill.js'

const previousProxyBase = process.env.INFTEST_PROXY_BASE_URL
const previousEnumFormat = process.env.INFTEST_PROXY_STATUS_ENUM_FORMAT
const tempRoots: string[] = []

afterEach(() => {
  if (previousProxyBase === undefined) {
    delete process.env.INFTEST_PROXY_BASE_URL
  } else {
    process.env.INFTEST_PROXY_BASE_URL = previousProxyBase
  }
  if (previousEnumFormat === undefined) {
    delete process.env.INFTEST_PROXY_STATUS_ENUM_FORMAT
  } else {
    process.env.INFTEST_PROXY_STATUS_ENUM_FORMAT = previousEnumFormat
  }
  for (const root of tempRoots.splice(0)) {
    try {
      Bun.spawnSync(['rm', '-rf', root])
    } catch {
      /* ignore */
    }
  }
})

test('ProxyClient.uploadAgentFile sends file_name and file multipart fields', async () => {
  const root = join('/tmp', `proxy-upload-${Date.now()}`)
  tempRoots.push(root)
  mkdirSync(root, { recursive: true })
  const filePath = join(root, 'ignored-path.docx')
  writeFileSync(filePath, 'docx-content')

  const originalFetch = globalThis.fetch
  let capturedForm: FormData | null = null
  globalThis.fetch = (async (_url, init) => {
    capturedForm = init?.body as FormData
    return new Response(
      JSON.stringify({
        code: 0,
        message: 'success',
        data: { file_key: '/mock/report.docx' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch

  process.env.INFTEST_PROXY_BASE_URL = 'http://127.0.0.1:5050'
  const client = new ProxyClient()
  const uploaded = await client.uploadAgentFile({
    task_id: 'exec-agent-test-001',
    plan_id: 'plan-agent-test',
    file_path: filePath,
    file_name: '冒烟测试报告_新华_xh.docx',
    file_type: 'analysis_report',
  })

  globalThis.fetch = originalFetch
  expect(uploaded.file_key).toBe('/mock/report.docx')
  expect(capturedForm?.get('file_name')).toBe('冒烟测试报告_新华_xh.docx')
  expect(capturedForm?.get('task_id')).toBe('exec-agent-test-001')
  expect(capturedForm?.get('plan_id')).toBe('plan-agent-test')
  const file = capturedForm?.get('file')
  expect(file).toBeInstanceOf(Blob)
})

test('ReportSkill SUCCESS telemetry uses defect_list instead of local paths', async () => {
  const root = join('/tmp', `report-skill-${Date.now()}`)
  tempRoots.push(root)
  mkdirSync(join(root, 'analysis', 'report_agent_output', '总报告'), {
    recursive: true,
  })
  mkdirSync(join(root, 'execution', 'results'), { recursive: true })
  writeFileSync(join(root, 'analysis', 'report.md'), '# report')
  writeFileSync(
    join(root, 'execution', 'results', 'case_result.json'),
    JSON.stringify({
      case_index: 1,
      case_id: 'case-agent-test-001',
      status: 'fail',
      risk_level: 'medium',
    }),
  )
  writeFileSync(
    join(
      root,
      'analysis',
      'report_agent_output',
      '总报告',
      '用例功能问题分析_sample.json',
    ),
    JSON.stringify({
      cases: [
        {
          case_id: 1,
          functional_status: 'failed',
          functional_problem_summary: '缺陷标题',
          failure_attribution_rationale: '缺陷描述',
        },
      ],
    }),
  )
  writeFileSync(
    join(root, 'analysis', 'report_agent_output', '总报告', '功能测试报告_新华_xh.docx'),
    'f',
  )
  writeFileSync(
    join(root, 'analysis', 'report_agent_output', '总报告', '集成测试报告_新华_xh.docx'),
    'i',
  )
  writeFileSync(
    join(root, 'analysis', 'report_agent_output', '总报告', '冒烟测试报告_新华_xh.docx'),
    's',
  )

  const skill = new ReportSkill()
  const result = await skill.run({
    task_id: 'exec-agent-test-001',
    workspace: root,
    session: {
      task_id: 'exec-agent-test-001',
      status: 'RUNNING',
      current_stage: 'REFLECTING',
      workspace: root,
      artifacts: {},
      created_at: '',
      updated_at: '',
      last_error: null,
      run_fake_e2e_invoked: false,
    },
  })

  expect(result.status).toBe('SUCCESS')
  expect(result.telemetry?.output_json).toBeTruthy()
  expect(result.telemetry?.output_json).not.toContain('/tmp/')
  const parsed = JSON.parse(result.telemetry!.output_json!) as {
    defect_list: Array<{ title: string; related_cases: string[] }>
    report_files: Array<{ kind: string; file_name: string }>
  }
  expect(parsed.defect_list[0]?.title).toBe('缺陷标题')
  expect(parsed.defect_list[0]?.related_cases).toEqual(['case-agent-test-001'])
  expect(parsed.report_files.map(item => item.kind)).toEqual([
    'functional',
    'integration',
    'smoke',
  ])
})

test('FinalizeSkill does not call proxy-update-task-status for COMPLETED stage', async () => {
  let taskUpdateCount = 0
  const proxy = {
    reportTaskUpdate: async () => {
      taskUpdateCount += 1
      return { accepted: true }
    },
    reportPlanFinalStatus: async () => ({ accepted: true, plan_id: 'plan-agent-test' }),
  } as unknown as ProxyClient

  const { FinalizeSkill } = await import('../skills/FinalizeSkill.js')
  const skill = new FinalizeSkill(proxy)
  const result = await skill.run({
    task_id: 'exec-agent-test-001',
    workspace: '/tmp/ws',
    session: {
      task_id: 'exec-agent-test-001',
      status: 'RUNNING',
      current_stage: 'COMPLETED',
      workspace: '/tmp/ws',
      artifacts: {},
      created_at: '',
      updated_at: '',
      last_error: null,
      run_fake_e2e_invoked: false,
    },
  })

  expect(result.status).toBe('SUCCESS')
  expect(taskUpdateCount).toBe(0)
})

test('reportPlanFinalStatusWithUpload does not upload files or send report_file_key', async () => {
  const root = join('/tmp', `plan-final-${Date.now()}`)
  tempRoots.push(root)
  mkdirSync(root, { recursive: true })
  const docxPath = join(root, '功能测试报告_新华_xh.docx')
  writeFileSync(docxPath, 'docx')

  let uploadCount = 0
  let finalPayload: Record<string, unknown> | null = null
  const proxy = {
    uploadAgentFile: async () => {
      uploadCount += 1
      return { accepted: true, file_key: 'x', path: docxPath }
    },
    reportPlanFinalStatus: async (input: Record<string, unknown>) => {
      finalPayload = input
      return { accepted: true, plan_id: 'plan-agent-test' }
    },
  } as unknown as ProxyClient

  await reportPlanFinalStatusWithUpload({
    task_id: 'exec-agent-test-001',
    task_status: 'SUCCESS',
    workspace: root,
    analysis_report_path: docxPath,
    report_file_key: '/mock/key',
    message: 'done',
    proxy_client: proxy,
  })

  expect(uploadCount).toBe(0)
  expect(finalPayload).toEqual({
    plan_id: 'exec-agent-test-001',
    task_id: 'exec-agent-test-001',
    task_status: 'SUCCESS',
    message: 'done',
  })
})

test('REFLECTING SUCCESS payload keeps defect_list and omits workspace paths', () => {
  process.env.INFTEST_PROXY_STATUS_ENUM_FORMAT = 'int'
  const payload = buildUpdateTaskStatusPayload({
    event_id: 'evt-1',
    task_id: 'exec-agent-test-001',
    current_stage: 'REFLECTING',
    task_status: 'SUCCESS',
    output_json: JSON.stringify({ defect_list: [] }),
    step_log: 'Report generation completed',
    stage_operations: [],
    case_node_operations: [],
    case_detail_operations: [],
  })
  expect(payload.output_json).toBe(JSON.stringify({ defect_list: [] }))
  expect(payload.output_json).not.toContain('/data/inftest-workspace')
  expect(payload.agent_name).toBe(5)
  expect(payload.agent_status).toBe(3)
})
