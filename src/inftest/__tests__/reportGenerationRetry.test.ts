import { afterEach, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { getDefaultInfTestWorkspaceRoot } from '../adapters/WorkspaceManager.js'
import { TaskSessionManager } from '../TaskSessionManager.js'
import {
  bootstrapReportGenerationSessionFromDisk,
  clearTaskReportGenerationJobsForTests,
  scheduleTaskReportGenerateAsync,
  seedReportGenerationJobForTests,
  shouldRetryReportGenerationAfterFailed,
} from '../server/taskExecutionService.js'

afterEach(() => {
  TaskSessionManager.clearAll()
  clearTaskReportGenerationJobsForTests()
})

test('shouldRetryReportGenerationAfterFailed when md_file_key changes', () => {
  expect(
    shouldRetryReportGenerationAfterFailed(
      {
        task_id: 't1',
        status: 'FAILED',
        report_path: null,
        report_file_key: null,
        md_file_key: '/old/doc.docx',
        error: 'x',
        started_at: '',
        updated_at: '',
        finished_at: '',
      },
      '/new/doc.docx',
    ),
  ).toBe(true)
  expect(
    shouldRetryReportGenerationAfterFailed(
      {
        task_id: 't1',
        status: 'FAILED',
        report_path: null,
        report_file_key: null,
        md_file_key: '/same/doc.docx',
        error: 'x',
        started_at: '',
        updated_at: '',
        finished_at: '',
      },
      '/same/doc.docx',
    ),
  ).toBe(false)
})

test('scheduleTaskReportGenerateAsync retries after FAILED when md_file_key changes', async () => {
  const taskId = 'exec-report-retry-md-key'
  const workspace = join(getDefaultInfTestWorkspaceRoot(), taskId)
  await mkdir(join(workspace, 'execution', 'results'), { recursive: true })
  await writeFile(
    join(workspace, 'execution', 'results', 'case_result.json'),
    `${JSON.stringify({ task_id: taskId, case_index: 1, status: 'pass', steps_info: [] }, null, 2)}\n`,
    'utf8',
  )

  bootstrapReportGenerationSessionFromDisk(taskId)
  seedReportGenerationJobForTests(taskId, {
    status: 'FAILED',
    md_file_key: '/etc/inftest-main-agent/requirements-placeholder.docx',
    error: 'placeholder failed',
    finished_at: new Date().toISOString(),
  })

  const retried = scheduleTaskReportGenerateAsync(taskId, {
    md_file_key: '/root/test_file/旅居系统-权益核销-前台1.0.2.docx',
  })
  expect(retried.httpStatus).toBe(200)
  expect(retried.data?.accepted).toBe(true)
  expect(retried.message).toContain('re-scheduled')

  const duplicate = scheduleTaskReportGenerateAsync(taskId, {
    md_file_key: '/root/test_file/旅居系统-权益核销-前台1.0.2.docx',
  })
  expect(duplicate.data?.accepted).toBe(false)
})
