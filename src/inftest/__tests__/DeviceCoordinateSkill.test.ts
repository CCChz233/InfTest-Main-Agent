import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { TaskSession } from '../schemas/session.js'
import { DeviceCoordinateSkill } from '../skills/DeviceCoordinateSkill.js'

const previousRealDevice = process.env.INFTEST_REAL_DEVICE_SCHEDULER

afterEach(() => {
  if (previousRealDevice === undefined) {
    delete process.env.INFTEST_REAL_DEVICE_SCHEDULER
  } else {
    process.env.INFTEST_REAL_DEVICE_SCHEDULER = previousRealDevice
  }
})

test('DeviceCoordinateSkill uses real subagent and writes canonical artifacts', async () => {
  process.env.INFTEST_REAL_DEVICE_SCHEDULER = '1'
  const tempRoot = join(process.cwd(), '.inftest-workspace', 'tmp-tests')
  await mkdir(tempRoot, { recursive: true })
  const workspace = await mkdtemp(join(tempRoot, 'inftest-device-skill-'))
  await mkdir(join(workspace, 'case_generation'), { recursive: true })
  await mkdir(join(workspace, 'device_scheduling'), { recursive: true })
  await writeFile(
    join(workspace, 'case_generation', 'test_cases.json'),
    `${JSON.stringify(
      {
        root: {
          children: [
            {
              node_id: 'case-1',
              title: 'generated case',
              test_steps: ['step1'],
              expected_result: ['ok'],
              case_function_point: 'fp',
              test_scenario: 'scene',
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  const bindingsFromAgent = join(workspace, 'device_scheduling', 'real-bindings.json')
  const bindFromAgent = join(workspace, 'device_scheduling', 'real-case-bind.json')
  await writeFile(
    bindingsFromAgent,
    `${JSON.stringify({ from: 'real-device-agent' }, null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    bindFromAgent,
    `${JSON.stringify({ device_case: { 'dev-1': { case_id: 'case-1' } } }, null, 2)}\n`,
    'utf8',
  )

  const fakeSubAgent = {
    async invoke(input: { output_json: string }) {
      await writeFile(
        input.output_json,
        `${JSON.stringify(
          {
            success: true,
            artifacts: {
              device_bindings: bindingsFromAgent,
              device_case_bind: bindFromAgent,
            },
          },
          null,
          2,
        )}\n`,
        'utf8',
      )
      return {
        success: true,
        output: {
          artifacts: {
            device_bindings: bindingsFromAgent,
            device_case_bind: bindFromAgent,
          },
        },
        error: null,
        agent_name: 'device_scheduler',
        output_json: input.output_json,
        exit_code: 0,
        stdout_log: '',
        stderr_log: '',
        duration_ms: 1,
      }
    },
  }

  const skill = new DeviceCoordinateSkill(undefined, 'device-001', fakeSubAgent as any)
  const result = await skill.run({
    task_id: 'task-device-001',
    workspace,
    session: {} as TaskSession,
  })

  expect(result.status).toBe('SUCCESS')
  const resultJson = JSON.parse(
    await readFile(join(workspace, 'device_scheduling', 'result.json'), 'utf8'),
  ) as { source?: string }
  expect(resultJson.source).toBe('real_subagent')
  const canonicalBindings = await readFile(
    join(workspace, 'device_scheduling', 'device_bindings.json'),
    'utf8',
  )
  const canonicalBind = await readFile(
    join(workspace, 'device_scheduling', 'device_case_bind.json'),
    'utf8',
  )
  expect(canonicalBindings).toContain('real-device-agent')
  expect(canonicalBind).toContain('device_case')
  await rm(workspace, { recursive: true, force: true })
})

test('DeviceCoordinateSkill fails when real scheduler returns no bind artifact', async () => {
  process.env.INFTEST_REAL_DEVICE_SCHEDULER = '1'
  const tempRoot = join(process.cwd(), '.inftest-workspace', 'tmp-tests')
  await mkdir(tempRoot, { recursive: true })
  const workspace = await mkdtemp(join(tempRoot, 'inftest-device-fail-'))
  await mkdir(join(workspace, 'case_generation'), { recursive: true })
  await mkdir(join(workspace, 'device_scheduling'), { recursive: true })
  await writeFile(
    join(workspace, 'case_generation', 'test_cases.json'),
    `${JSON.stringify(
      {
        root: {
          children: [{ node_id: 'case-x', title: 'Case X', test_steps: ['s'], expected_result: ['ok'] }],
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  const fakeSubAgent = {
    async invoke(input: { output_json: string }) {
      await writeFile(
        input.output_json,
        `${JSON.stringify({ success: true, artifacts: {} }, null, 2)}\n`,
        'utf8',
      )
      return {
        success: true,
        output: { artifacts: {} },
        error: null,
        agent_name: 'device_scheduler',
        output_json: input.output_json,
        exit_code: 0,
        stdout_log: '',
        stderr_log: '',
        duration_ms: 1,
      }
    },
  }

  const skill = new DeviceCoordinateSkill(undefined, 'device-001', fakeSubAgent as any)
  const result = await skill.run({
    task_id: 'task-device-fail',
    workspace,
    session: {} as TaskSession,
  })

  expect(result.status).toBe('FAILED')
  expect(result.error?.code).toBe('DEVICE_CASE_BIND_MISSING')
  await rm(workspace, { recursive: true, force: true })
})

test('DeviceCoordinateSkill binds all case_publish cases in local fallback path', async () => {
  const tempRoot = join(process.cwd(), '.inftest-workspace', 'tmp-tests')
  await mkdir(tempRoot, { recursive: true })
  const workspace = await mkdtemp(join(tempRoot, 'inftest-device-multi-'))
  await mkdir(join(workspace, 'case_generation'), { recursive: true })
  await mkdir(join(workspace, 'device_scheduling'), { recursive: true })
  await writeFile(
    join(workspace, 'case_generation', 'test_cases.json'),
    `${JSON.stringify(
      {
        source: 'case_publish',
        root: {
          children: [
            {
              node_id: 'case-a',
              title: 'Case A',
              test_steps: ['step-a'],
              expected_result: ['ok-a'],
            },
            {
              node_id: 'case-b',
              title: 'Case B',
              test_steps: ['step-b'],
              expected_result: ['ok-b'],
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  const fakeSubAgent = {
    async invoke(input: { output_json: string }) {
      await writeFile(
        input.output_json,
        `${JSON.stringify({ success: false }, null, 2)}\n`,
        'utf8',
      )
      return {
        success: false,
        output: null,
        error: { code: 'MOCK', message: 'force fallback' },
        agent_name: 'device_scheduler',
        output_json: input.output_json,
        exit_code: 1,
        stdout_log: '',
        stderr_log: '',
        duration_ms: 1,
      }
    },
  }

  delete process.env.INFTEST_REAL_DEVICE_SCHEDULER
  delete process.env.INFTEST_DEVICE_AGENT_CMD
  const skill = new DeviceCoordinateSkill(undefined, 'device-001', fakeSubAgent as any)
  const result = await skill.run({
    task_id: 'task-device-multi',
    workspace,
    session: {} as TaskSession,
  })

  expect(result.status).toBe('SUCCESS')
  const bind = JSON.parse(
    await readFile(join(workspace, 'device_scheduling', 'device_case_bind.json'), 'utf8'),
  ) as { device_case: Record<string, { case_id: string }> }
  const boundCases = Object.values(bind.device_case).map(item => item.case_id)
  expect(boundCases.sort()).toEqual(['case-a', 'case-b'])
  await rm(workspace, { recursive: true, force: true })
})
