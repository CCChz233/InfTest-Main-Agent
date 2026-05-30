import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { PlanDetailInfo } from '../adapters/ProxyClient.js'
import type { ManualCase } from '../skills/staticArtifacts.js'
import {
  loadPlanConfig,
  loadPlanDetail,
  parsePlanDetailFromBody,
} from './planContextArtifacts.js'

export type CasePublishCaseInput = Record<string, unknown>

/** Interface doc L289–309: every step must carry all three fields on disk. */
export type CasePublishDocStep = {
  step_id: string
  action: string
  expected: string
}

export type CasePublishStructuredStep = {
  step_id?: string
  action: string
  expected: string
}

export type CasePublishParsedCase = {
  manual: ManualCase
  conditions: string
  structured_steps: CasePublishStructuredStep[]
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item)).filter(item => item.trim())
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()]
  }
  return []
}

function stringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function parseTestSteps(testSteps: unknown): {
  case_step: string[]
  expected_result: string[]
} {
  if (!Array.isArray(testSteps)) {
    return { case_step: [], expected_result: [] }
  }

  const caseStep: string[] = []
  const expectedResult: string[] = []

  for (const item of testSteps) {
    if (typeof item === 'string' && item.trim()) {
      caseStep.push(item.trim())
      continue
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const stepRecord = item as Record<string, unknown>
    const step =
      stringField(stepRecord, 'step') ??
      stringField(stepRecord, 'action') ??
      stringField(stepRecord, 'description')
    const expected =
      stringField(stepRecord, 'expected') ??
      stringField(stepRecord, 'expected_result')
    if (step) caseStep.push(step)
    if (expected) expectedResult.push(expected)
  }

  return { case_step: caseStep, expected_result: expectedResult }
}

export function parseStructuredSteps(rawSteps: unknown): CasePublishStructuredStep[] {
  if (!Array.isArray(rawSteps)) return []

  const structured: CasePublishStructuredStep[] = []
  for (const item of rawSteps) {
    if (typeof item === 'string' && item.trim()) {
      structured.push({ action: item.trim(), expected: '' })
      continue
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const stepRecord = item as Record<string, unknown>
    const action =
      stringField(stepRecord, 'action') ??
      stringField(stepRecord, 'step') ??
      stringField(stepRecord, 'description')
    if (!action) continue
    const stepId = stringField(stepRecord, 'step_id') ?? undefined
    const expected =
      stringField(stepRecord, 'expected') ??
      stringField(stepRecord, 'expected_result') ??
      ''
    structured.push({
      ...(stepId ? { step_id: stepId } : {}),
      action,
      expected,
    })
  }
  return structured
}

function resolveConditions(raw: CasePublishCaseInput): string {
  const fromConditions =
    stringField(raw, 'conditions') ??
    stringField(raw, 'condition') ??
    stringField(raw, 'preconditions')
  if (fromConditions) return fromConditions

  const list = toStringList(raw.preconditions)
  return list[0] ?? ''
}

function resolveRawSteps(raw: CasePublishCaseInput): unknown {
  if (Array.isArray(raw.steps) && raw.steps.length > 0) return raw.steps
  if (Array.isArray(raw.test_steps) && raw.test_steps.length > 0) return raw.test_steps
  if (Array.isArray(raw.case_step) && raw.case_step.length > 0) return raw.case_step
  return raw.steps ?? raw.test_steps ?? raw.case_step
}

export function casePublishCaseToManualCase(raw: CasePublishCaseInput): ManualCase {
  const caseId = stringField(raw, 'case_id') ?? 'case-unknown'
  const caseName = stringField(raw, 'case_name') ?? stringField(raw, 'title') ?? caseId
  const fromSteps = parseTestSteps(resolveRawSteps(raw))
  const directSteps = toStringList(raw.case_step)
  const directExpected = toStringList(raw.expected_result)
  const caseStep = directSteps.length > 0 ? directSteps : fromSteps.case_step
  const expectedResult =
    directExpected.length > 0 ? directExpected : fromSteps.expected_result

  const conditions = resolveConditions(raw)
  const functionPoint =
    stringField(raw, 'case_function_point') ??
    stringField(raw, 'type') ??
    (conditions || '用户确认用例')
  const scenario = stringField(raw, 'test_scenario') ?? caseName

  return {
    case_id: caseId,
    case_name: caseName,
    test_type: 'functional',
    case_function_point: functionPoint,
    test_scenario: scenario,
    case_step: caseStep,
    expected_result: expectedResult,
  }
}

export function casePublishCaseToParsedCase(raw: CasePublishCaseInput): CasePublishParsedCase {
  const manual = casePublishCaseToManualCase(raw)
  const structuredFromRaw = parseStructuredSteps(resolveRawSteps(raw))
  const structured_steps =
    structuredFromRaw.length > 0
      ? structuredFromRaw
      : manual.case_step.map((action, index) => ({
          step_id: String(index + 1),
          action,
          expected: manual.expected_result[index] ?? '',
        }))

  return {
    manual,
    conditions: resolveConditions(raw),
    structured_steps,
  }
}

function validateDocStep(
  step: unknown,
  caseIndex: number,
  stepIndex: number,
): string | null {
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    return `cases[${caseIndex}].steps[${stepIndex}] must be an object`
  }
  const record = step as Record<string, unknown>
  if (!stringField(record, 'action')) {
    return `cases[${caseIndex}].steps[${stepIndex}].action is required`
  }
  if (record.expected === undefined || record.expected === null) {
    return `cases[${caseIndex}].steps[${stepIndex}].expected is required`
  }
  if (typeof record.expected !== 'string') {
    return `cases[${caseIndex}].steps[${stepIndex}].expected must be a string`
  }
  if (!stringField(record, 'step_id')) {
    return `cases[${caseIndex}].steps[${stepIndex}].step_id is required`
  }
  return null
}

export function parseCasePublishCases(
  raw: unknown,
): { cases: CasePublishParsedCase[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'case-publish requires a non-empty cases array' }
  }

  const cases: CasePublishParsedCase[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index]
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { error: `cases[${index}] must be an object` }
    }
    const record = item as Record<string, unknown>
    if (!stringField(record, 'case_id')) {
      return { error: `cases[${index}].case_id is required` }
    }
    if (!stringField(record, 'title')) {
      return { error: `cases[${index}].title is required` }
    }
    if (record.conditions === undefined || record.conditions === null) {
      return { error: `cases[${index}].conditions is required` }
    }
    if (typeof record.conditions !== 'string') {
      return { error: `cases[${index}].conditions must be a string` }
    }
    const steps = record.steps
    if (!Array.isArray(steps) || steps.length === 0) {
      return { error: `cases[${index}].steps must be a non-empty array` }
    }
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
      const stepError = validateDocStep(steps[stepIndex], index, stepIndex)
      if (stepError) return { error: stepError }
    }
    cases.push(casePublishCaseToParsedCase(record))
  }

  return { cases }
}

export function validateCasePublishBody(
  body: Record<string, unknown>,
): string | null {
  if (!stringField(body, 'plan_id')) {
    return 'case-publish requires plan_id'
  }
  if (!stringField(body, 'plan_name')) {
    return 'case-publish requires plan_name'
  }
  if (!stringField(body, 'test_env_url')) {
    return 'case-publish requires test_env_url'
  }
  if (!Array.isArray(body.test_strategies) || body.test_strategies.length === 0) {
    return 'case-publish requires a non-empty test_strategies array'
  }
  const planDetail = body.plan_detail
  if (!planDetail || typeof planDetail !== 'object' || Array.isArray(planDetail)) {
    return 'case-publish requires plan_detail object'
  }
  const detail = planDetail as Record<string, unknown>
  for (const key of [
    'test_objectives',
    'test_scope',
    'test_target',
    'test_environment',
    'resources',
    'schedule',
    'deliverables',
  ] as const) {
    if (typeof detail[key] !== 'string') {
      return `plan_detail.${key} must be a string`
    }
  }
  const planConfig = body.plan_config_info
  if (
    planConfig !== undefined &&
    planConfig !== null &&
    (typeof planConfig !== 'object' || Array.isArray(planConfig))
  ) {
    return 'plan_config_info must be an object'
  }
  const rawCases = body.cases
  if (!Array.isArray(rawCases) || rawCases.length === 0) {
    return 'case-publish requires a non-empty cases array'
  }
  const parsed = parseCasePublishCases(rawCases)
  if ('error' in parsed) return parsed.error
  return null
}

type CasePublishArtifactMeta = {
  plan_id?: string | null
  exec_id: string
  plan_name?: string | null
}

const EMPTY_PLAN_DETAIL: PlanDetailInfo = {
  test_objectives: '',
  test_scope: '',
  test_target: '',
  test_environment: '',
  resources: '',
  schedule: '',
  deliverables: '',
}

export type CasePublishDocCase = {
  case_id: string
  title: string
  conditions: string
  steps: CasePublishDocStep[]
}

/** On-disk shape aligned with interface doc L267–313 (case-publish request body). */
export type CasePublishDocArtifact = {
  plan_id: string
  plan_name: string
  plan_detail: PlanDetailInfo
  test_strategies: string[]
  test_env_url: string
  plan_config_info: Record<string, unknown>
  exec_id: string
  cases: CasePublishDocCase[]
}

export function isCasePublishDocArtifact(payload: unknown): payload is CasePublishDocArtifact {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const record = payload as Record<string, unknown>
  if (typeof record.plan_id !== 'string') return false
  if (typeof record.exec_id !== 'string') return false
  if (!Array.isArray(record.cases) || record.cases.length === 0) return false
  if (record.root !== undefined) return false
  return true
}

export function normalizeDocSteps(
  steps: CasePublishStructuredStep[],
): CasePublishDocStep[] {
  return steps.map((step, index) => ({
    step_id: step.step_id?.trim() || String(index + 1),
    action: step.action,
    expected: step.expected ?? '',
  }))
}

function planConfigFromBody(body: Record<string, unknown>): Record<string, unknown> {
  const raw = body.plan_config_info
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return {}
}

function testStrategiesFromBody(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body.test_strategies)) return []
  return body.test_strategies
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => String(item).trim())
}

export function parsedCasesToDocCases(
  parsedCases: CasePublishParsedCase[],
): CasePublishDocCase[] {
  return parsedCases.map(entry => ({
    case_id: entry.manual.case_id,
    title: entry.manual.case_name,
    conditions: entry.conditions,
    steps: normalizeDocSteps(entry.structured_steps),
  }))
}

/**
 * Writes `case_generation/test_cases.json` in the same envelope as the interface doc
 * (not the internal root.children tree).
 */
export function buildDocFormatCasePublishArtifact(
  body: Record<string, unknown>,
  parsedCases: CasePublishParsedCase[],
  meta: CasePublishArtifactMeta,
): CasePublishDocArtifact {
  return {
    plan_id: meta.plan_id ?? stringField(body, 'plan_id') ?? '',
    plan_name: meta.plan_name ?? stringField(body, 'plan_name') ?? '',
    plan_detail: parsePlanDetailFromBody(body) ?? EMPTY_PLAN_DETAIL,
    test_strategies: testStrategiesFromBody(body),
    test_env_url: stringField(body, 'test_env_url') ?? '',
    plan_config_info: planConfigFromBody(body),
    exec_id: meta.exec_id,
    cases: parsedCasesToDocCases(parsedCases),
  }
}

export function writeDocFormatTestCases(
  workspace: string,
  artifact: CasePublishDocArtifact,
): string {
  const path = join(workspace, 'case_generation', 'test_cases.json')
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  return path
}

export function loadCasePublishBodyFromWorkspace(
  workspace: string,
  execId: string,
): Record<string, unknown> {
  const requestPath = join(workspace, 'input', 'case_publish_request.json')
  if (existsSync(requestPath)) {
    try {
      const raw = JSON.parse(readFileSync(requestPath, 'utf8')) as unknown
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return raw as Record<string, unknown>
      }
    } catch {
      /* fall through */
    }
  }

  const planDetail = loadPlanDetail(workspace) ?? EMPTY_PLAN_DETAIL
  let testEnvUrl = ''
  const taskDetailPath = join(workspace, 'input', 'task_detail.json')
  if (existsSync(taskDetailPath)) {
    try {
      const taskDetail = JSON.parse(readFileSync(taskDetailPath, 'utf8')) as Record<
        string,
        unknown
      >
      testEnvUrl = stringField(taskDetail, 'task_target') ?? ''
    } catch {
      /* ignore */
    }
  }

  return {
    plan_id: execId,
    plan_name: execId,
    plan_detail: planDetail,
    test_strategies: [],
    test_env_url: testEnvUrl,
    plan_config_info: loadPlanConfig(workspace) ?? {},
    exec_id: execId,
  }
}

function treePayloadToParsedCases(payload: unknown): CasePublishParsedCase[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const record = payload as Record<string, unknown>
  const root = record.root
  if (!root || typeof root !== 'object' || Array.isArray(root)) return []
  const children = (root as Record<string, unknown>).children
  if (!Array.isArray(children)) return []

  const cases: CasePublishParsedCase[] = []
  for (const child of children) {
    if (!child || typeof child !== 'object' || Array.isArray(child)) continue
    const node = child as Record<string, unknown>
    const caseId = stringField(node, 'node_id') ?? stringField(node, 'case_id')
    const title = stringField(node, 'title') ?? stringField(node, 'case_name')
    if (!caseId || !title) continue
    const parsed = casePublishCaseToParsedCase({
      case_id: caseId,
      title,
      conditions: stringField(node, 'conditions') ?? '',
      steps: node.steps ?? node.test_steps ?? node.case_step,
    })
    cases.push(parsed)
  }
  return cases
}

/** Rewrite legacy tree `test_cases.json` to strict doc envelope when needed. */
export function ensureDocFormatTestCasesFile(
  workspace: string,
  execId: string,
): CasePublishDocArtifact | null {
  const path = join(workspace, 'case_generation', 'test_cases.json')
  if (!existsSync(path)) return null

  let payload: unknown
  try {
    payload = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }

  if (isCasePublishDocArtifact(payload)) {
    return payload
  }

  const body = loadCasePublishBodyFromWorkspace(workspace, execId)
  const fromTree = treePayloadToParsedCases(payload)
  const fromCases = Array.isArray((payload as Record<string, unknown>).cases)
    ? parseCasePublishCases((payload as Record<string, unknown>).cases)
    : null
  const parsedCases =
    fromTree.length > 0
      ? fromTree
      : fromCases && 'cases' in fromCases
        ? fromCases.cases
        : []
  if (parsedCases.length === 0) return null

  const artifact = buildDocFormatCasePublishArtifact(body, parsedCases, {
    plan_id: stringField(body, 'plan_id'),
    exec_id: execId,
    plan_name: stringField(body, 'plan_name'),
  })
  writeDocFormatTestCases(workspace, artifact)
  return artifact
}

type CaseTreeNode = {
  node_id?: string
  title?: string
  case_name?: string
  steps?: unknown
  test_steps?: unknown
  case_step?: unknown
  expected_result?: unknown
  case_function_point?: string
  test_scenario?: string
  conditions?: string
}

function treeNodeToManualCase(node: CaseTreeNode): ManualCase | null {
  const caseId = node.node_id ?? node.case_name ?? node.title
  if (!caseId) return null

  const rawSteps = node.steps ?? node.case_step ?? node.test_steps
  const parsed = parseTestSteps(rawSteps)
  const directExpected = toStringList(node.expected_result)
  const expectedResult =
    directExpected.length > 0 ? directExpected : parsed.expected_result

  return {
    case_id: caseId,
    case_name: node.case_name ?? node.title ?? caseId,
    test_type: 'functional',
    case_step: parsed.case_step,
    expected_result: expectedResult,
    case_function_point:
      node.case_function_point ??
      node.conditions ??
      '自动生成功能点',
    test_scenario: node.test_scenario ?? node.title ?? '自动生成场景',
  }
}

export function readExecutableCasesFromTestCases(payload: unknown): ManualCase[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return []
  }

  const record = payload as Record<string, unknown>

  const legacyCases = record.cases
  if (Array.isArray(legacyCases) && legacyCases.length > 0) {
    const parsed = parseCasePublishCases(legacyCases)
    return 'cases' in parsed ? parsed.cases.map(entry => entry.manual) : []
  }

  const root = record.root
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    return []
  }

  const children = (root as Record<string, unknown>).children
  if (!Array.isArray(children)) {
    return []
  }

  const cases: ManualCase[] = []
  for (const child of children) {
    if (!child || typeof child !== 'object' || Array.isArray(child)) continue
    const manualCase = treeNodeToManualCase(child as CaseTreeNode)
    if (manualCase) cases.push(manualCase)
  }
  return cases
}
