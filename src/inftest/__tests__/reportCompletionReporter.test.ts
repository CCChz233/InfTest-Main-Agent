import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { afterEach, expect, test } from 'bun:test'
import {
  buildCaseIdByIndex,
  buildDefectListFromReportAgent,
  buildReportCompletionOutputJson,
  deliverReportArtifacts,
  findReportDocxFiles,
  reportAnalysisRunningStatus,
  resolvePlanIdFromWorkspace,
} from '../server/reportCompletionReporter.js'
import { ProxyClient } from '../adapters/ProxyClient.js'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    try {
      Bun.spawnSync(['rm', '-rf', root])
    } catch {
      /* ignore */
    }
  }
})

function makeWorkspace(input: {
  planId?: string
  caseResult: Record<string, unknown>
  problemAnalysis: Record<string, unknown>
}): string {
  const root = join(
    '/tmp',
    `report-completion-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  tempRoots.push(root)
  mkdirSync(join(root, 'input'), { recursive: true })
  mkdirSync(join(root, 'execution', 'results'), { recursive: true })
  mkdirSync(
    join(root, 'analysis', 'report_agent_output', '总报告'),
    { recursive: true },
  )

  if (input.planId) {
    writeFileSync(
      join(root, 'input', 'task_report_generate_request.json'),
      JSON.stringify({ plan_id: input.planId }),
    )
  }
  writeFileSync(
    join(root, 'execution', 'results', 'case_result.json'),
    JSON.stringify(input.caseResult),
  )
  writeFileSync(
    join(
      root,
      'analysis',
      'report_agent_output',
      '总报告',
      '用例功能问题分析_sample.json',
    ),
    JSON.stringify(input.problemAnalysis),
  )
  return root
}

test('buildDefectListFromReportAgent returns empty list when all cases pass', () => {
  const workspace = makeWorkspace({
    planId: 'plan-agent-test',
    caseResult: {
      task_id: 'exec-agent-test-001',
      case_index: 1,
      case_id: 'case-agent-test-001',
      status: 'pass',
    },
    problemAnalysis: {
      cases: [
        {
          case_id: 1,
          case_name: 'Case 1',
          functional_status: 'passed',
          functional_problem_summary: '（通过）',
        },
      ],
    },
  })

  expect(buildDefectListFromReportAgent(workspace)).toEqual([])
})

test('buildDefectListFromReportAgent maps failed case to colleague defect schema', () => {
  const workspace = makeWorkspace({
    planId: 'plan-agent-test',
    caseResult: {
      task_id: 'exec-agent-test-001',
      case_index: 1,
      case_id: 'case-agent-test-001',
      status: 'fail',
      risk_level: 'high',
    },
    problemAnalysis: {
      cases: [
        {
          case_id: 1,
          case_name: '登录失败',
          functional_status: 'failed',
          functional_problem_summary: '登录按钮无响应',
          failure_attribution_rationale: '页面未加载完成',
          scenario_match_note: '场景不匹配',
        },
      ],
    },
  })

  const defects = buildDefectListFromReportAgent(workspace)
  expect(defects).toHaveLength(1)
  expect(defects[0]).toEqual({
    title: '登录按钮无响应',
    description: '页面未加载完成',
    severity: 'FATAL',
    priority: 'P0',
    status: 'OPEN',
    remark: '场景不匹配',
    related_cases: ['case-agent-test-001'],
  })
})

test('buildReportCompletionOutputJson serializes defect_list only', () => {
  const output = buildReportCompletionOutputJson([
    {
      title: 't',
      description: 'd',
      severity: 'MAJOR',
      priority: 'P2',
      status: 'OPEN',
      remark: '',
      related_cases: ['case-1'],
    },
  ])
  const parsed = JSON.parse(output) as {
    defect_list: Array<{ title: string }>
  }
  expect(parsed.defect_list[0]?.title).toBe('t')
  expect(output).not.toContain('/data/inftest-workspace')
})

test('resolvePlanIdFromWorkspace prefers request plan_id over exec id', () => {
  const workspace = makeWorkspace({
    planId: 'plan-agent-test',
    caseResult: { case_index: 1, case_id: 'case-1' },
    problemAnalysis: { cases: [] },
  })
  expect(resolvePlanIdFromWorkspace(workspace, 'exec-agent-test-001')).toBe(
    'plan-agent-test',
  )
})

test('buildCaseIdByIndex maps numeric case index to workspace case_id', () => {
  const workspace = makeWorkspace({
    caseResult: {
      case_index: 1,
      case_id: 'case-agent-test-001',
    },
    problemAnalysis: { cases: [] },
  })
  expect(buildCaseIdByIndex(workspace).get(1)).toBe('case-agent-test-001')
})

test('findReportDocxFiles returns functional integration smoke and excludes detail docx', () => {
  const workspace = makeWorkspace({
    caseResult: { case_index: 1, case_id: 'case-1' },
    problemAnalysis: { cases: [] },
  })
  const summaryDir = join(
    workspace,
    'analysis',
    'report_agent_output',
    '总报告',
  )
  writeFileSync(join(summaryDir, '功能测试报告_新华_xh.docx'), 'f')
  writeFileSync(join(summaryDir, '集成测试报告_新华_xh.docx'), 'i')
  writeFileSync(join(summaryDir, '冒烟测试报告_新华_xh.docx'), 's')
  writeFileSync(join(summaryDir, '用例处理明细_功能_集成_冒烟_新华_xh.docx'), 'd')

  const files = findReportDocxFiles(workspace)
  expect(files.map(item => item.kind)).toEqual([
    'functional',
    'integration',
    'smoke',
  ])
  expect(files.map(item => item.file_name)).toEqual([
    '功能测试报告_新华_xh.docx',
    '集成测试报告_新华_xh.docx',
    '冒烟测试报告_新华_xh.docx',
  ])
})

test('deliverReportArtifacts uploads three report docx files', async () => {
  const workspace = makeWorkspace({
    planId: 'plan-agent-test',
    caseResult: { case_index: 1, case_id: 'case-1' },
    problemAnalysis: { cases: [] },
  })
  const summaryDir = join(
    workspace,
    'analysis',
    'report_agent_output',
    '总报告',
  )
  writeFileSync(join(summaryDir, '功能测试报告_新华_xh.docx'), 'f')
  writeFileSync(join(summaryDir, '集成测试报告_新华_xh.docx'), 'i')
  writeFileSync(join(summaryDir, '冒烟测试报告_新华_xh.docx'), 's')

  const uploadCalls: Array<{ file_name?: string; file_path: string }> = []
  const proxy = {
    uploadAgentFile: async (input: {
      file_name?: string
      file_path: string
    }) => {
      uploadCalls.push(input)
      return {
        accepted: true,
        file_key: `/mock/${input.file_name ?? 'unknown'}`,
        path: input.file_path,
      }
    },
    reportTaskUpdate: async () => ({ accepted: true }),
  } as unknown as ProxyClient

  const delivered = await deliverReportArtifacts({
    task_id: 'exec-agent-test-001',
    workspace,
    proxy,
  })

  expect(uploadCalls).toHaveLength(3)
  expect(uploadCalls.map(item => item.file_name)).toEqual([
    '功能测试报告_新华_xh.docx',
    '集成测试报告_新华_xh.docx',
    '冒烟测试报告_新华_xh.docx',
  ])

  const parsed = JSON.parse(delivered.output_json) as {
    report_files: Array<{ kind: string; file_name: string; file_key?: string }>
    report_file_key?: string
  }
  expect(parsed.report_files).toHaveLength(3)
  expect(parsed.report_files[0]?.kind).toBe('functional')
  expect(parsed.report_file_key).toBe('/mock/功能测试报告_新华_xh.docx')
})

test('reportAnalysisRunningStatus sends result_analyzer RUNNING before completion', async () => {
  const updates: Array<Record<string, unknown>> = []
  const proxy = {
    reportTaskUpdate: async (update: Record<string, unknown>) => {
      updates.push(update)
      return { accepted: true }
    },
  } as unknown as ProxyClient

  const startedAt = await reportAnalysisRunningStatus({
    task_id: 'exec-agent-test-001',
    proxy,
    step_log: 'Report generation started',
    started_at: '2026-05-30T08:00:00.000Z',
  })

  expect(startedAt).toBe('2026-05-30T08:00:00Z')
  expect(updates).toHaveLength(1)
  expect(updates[0]?.agent_name).toBe('result_analyzer')
  expect(updates[0]?.proxy_status).toBe('RUNNING')
  expect(updates[0]?.current_stage).toBe('REFLECTING')
  expect(updates[0]?.output_json).toBe('{}')
  expect(updates[0]?.step_log).toBe('Report generation started')
})
