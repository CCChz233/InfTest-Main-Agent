import { randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { z } from 'zod/v4'
import { apiError, apiSuccess, jsonApiResponse } from './apiResponse.js'

const PLANNER_API_STUB_LOG_DIR = resolve(
  process.cwd(),
  '.inftest-workspace',
  'planner-api-stub',
)

const NonEmptyStringSchema = z.string().trim().min(1)
const JsonObjectSchema = z.record(z.string(), z.unknown())

const GeneratePlanRequestSchema = z
  .object({
    plan_name: NonEmptyStringSchema,
    project_id: NonEmptyStringSchema,
    prd_file_key: NonEmptyStringSchema,
    test_env_url: NonEmptyStringSchema,
    test_strategies: z.array(NonEmptyStringSchema).min(1),
    plan_config_info: JsonObjectSchema,
  })
  .passthrough()

const PlanTaskPublishRequestSchema = z
  .object({
    plan_id: NonEmptyStringSchema,
  })
  .passthrough()

const CasePublishRequestSchema = z
  .object({
    plan_id: NonEmptyStringSchema,
  })
  .passthrough()

const TaskReportGenerateRequestSchema = z
  .object({
    exec_id: NonEmptyStringSchema.optional(),
    task_id: NonEmptyStringSchema.optional(),
  })
  .passthrough()

const TaskManageRequestSchema = z
  .object({
    exec_id: NonEmptyStringSchema.optional(),
    task_id: NonEmptyStringSchema.optional(),
    task_operation: z.enum([
      'START',
      'PAUSE',
      'CONTINUE',
      'TERMINATION',
      'RESTART',
    ]),
  })
  .passthrough()

const UserInstructionRequestSchema = z
  .object({
    user_instruction: NonEmptyStringSchema,
  })
  .passthrough()

type PlannerApiStubEndpoint =
  | '/api/generate-plan'
  | '/api/plan-task-publish'
  | '/api/case-publish'
  | '/api/task-report-generate'
  | '/api/task-manage'
  | '/api/user-instruction'

type ValidationResult =
  | { success: true }
  | { success: false; issues: unknown[] }

const PLANNER_API_STUB_ENDPOINTS = new Set<string>([
  '/api/generate-plan',
  '/api/plan-task-publish',
  '/api/case-publish',
  '/api/task-report-generate',
  '/api/task-manage',
  '/api/user-instruction',
  '/api/payload',
])

function canonicalPlannerApiStubEndpoint(
  pathname: string,
): PlannerApiStubEndpoint | null {
  if (pathname === '/api/payload') return '/api/user-instruction'
  if (!PLANNER_API_STUB_ENDPOINTS.has(pathname)) return null
  return pathname as PlannerApiStubEndpoint
}

export function isPlannerApiStubPath(pathname: string): boolean {
  return canonicalPlannerApiStubEndpoint(pathname) !== null
}

function recordFromBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
  return body as Record<string, unknown>
}

function stringField(
  body: Record<string, unknown>,
  field: string,
): string | null {
  const value = body[field]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function execIdField(body: Record<string, unknown>): string | null {
  return stringField(body, 'exec_id') ?? stringField(body, 'task_id')
}

function arrayFieldExists(
  body: Record<string, unknown>,
  field: string,
): boolean {
  return Array.isArray(body[field])
}

function hasAnyField(body: Record<string, unknown>, fields: string[]): boolean {
  return fields.some(field => body[field] !== undefined)
}

function sanitizeRequestId(requestId: string): string {
  const trimmed = requestId.trim()
  const sanitized = trimmed.replace(/[^A-Za-z0-9._-]/g, '_')
  return sanitized === '' ? randomUUID() : sanitized
}

function pickRequestId(
  request: Request,
  body: unknown,
): {
  requestId: string
  originalRequestId: string | null
} {
  const bodyRecord = recordFromBody(body)
  const rawRequestId =
    stringField(bodyRecord, 'request_id') ??
    request.headers.get('x-request-id') ??
    randomUUID()
  return {
    requestId: sanitizeRequestId(rawRequestId),
    originalRequestId: rawRequestId,
  }
}

function selectedHeaders(request: Request): Record<string, string> {
  const selected: Record<string, string> = {}
  for (const key of [
    'content-type',
    'user-agent',
    'x-request-id',
    'x-correlation-id',
  ]) {
    const value = request.headers.get(key)
    if (value) selected[key] = value
  }
  return selected
}

function validatePlannerApiStubBody(
  endpoint: PlannerApiStubEndpoint,
  body: unknown,
): ValidationResult {
  const schemaResult = (() => {
    switch (endpoint) {
      case '/api/generate-plan':
        return GeneratePlanRequestSchema.safeParse(body)
      case '/api/plan-task-publish':
        return PlanTaskPublishRequestSchema.safeParse(body)
      case '/api/case-publish':
        return CasePublishRequestSchema.safeParse(body)
      case '/api/task-report-generate':
        return TaskReportGenerateRequestSchema.safeParse(body)
      case '/api/task-manage':
        return TaskManageRequestSchema.safeParse(body)
      case '/api/user-instruction':
        return UserInstructionRequestSchema.safeParse(body)
    }
  })()

  if (!schemaResult.success) {
    return { success: false, issues: schemaResult.error.issues }
  }

  const bodyRecord = recordFromBody(body)
  if (
    (endpoint === '/api/task-report-generate' ||
      endpoint === '/api/task-manage') &&
    !execIdField(bodyRecord)
  ) {
    return {
      success: false,
      issues: [
        {
          path: ['exec_id'],
          message: `${endpoint} requires exec_id`,
        },
      ],
    }
  }

  if (
    endpoint === '/api/case-publish' &&
    !arrayFieldExists(bodyRecord, 'cases') &&
    !arrayFieldExists(bodyRecord, 'task_list') &&
    !arrayFieldExists(bodyRecord, 'tasks')
  ) {
    return {
      success: false,
      issues: [
        {
          path: ['cases'],
          message: 'case-publish requires cases, task_list, or tasks array',
        },
      ],
    }
  }

  if (
    endpoint === '/api/plan-task-publish' &&
    !hasAnyField(bodyRecord, [
      'tasks',
      'task_list',
      'new_tasks',
      'deleted_task_ids',
      'plan_detail',
    ])
  ) {
    return {
      success: false,
      issues: [
        {
          path: ['tasks'],
          message:
            'plan-task-publish requires tasks, task_list, new_tasks, deleted_task_ids, or plan_detail',
        },
      ],
    }
  }

  if (
    endpoint === '/api/user-instruction' &&
    !stringField(bodyRecord, 'plan_id') &&
    !execIdField(bodyRecord)
  ) {
    return {
      success: false,
      issues: [
        {
          path: ['plan_id'],
          message: 'user-instruction requires plan_id or exec_id',
        },
      ],
    }
  }

  return { success: true }
}

function statusForTaskOperation(operation: unknown): string {
  switch (operation) {
    case 'START':
    case 'RESTART':
      return 'PENDING'
    case 'PAUSE':
      return 'PAUSED'
    case 'CONTINUE':
      return 'RUNNING'
    case 'TERMINATION':
      return 'TERMINATED'
    default:
      return 'ACCEPTED'
  }
}

function buildPlannerApiStubData(
  endpoint: PlannerApiStubEndpoint,
  requestId: string,
  body: unknown,
): Record<string, unknown> {
  const bodyRecord = recordFromBody(body)
  const base = {
    request_id: requestId,
    endpoint,
    accepted: true,
    stub: true,
  }

  switch (endpoint) {
    case '/api/generate-plan':
      return {
        ...base,
        plan_id: stringField(bodyRecord, 'plan_id'),
        plan_status: 'STUB_ACCEPTED',
      }
    case '/api/plan-task-publish':
      return {
        ...base,
        plan_id: stringField(bodyRecord, 'plan_id'),
        publish_status: 'STUB_ACCEPTED',
      }
    case '/api/case-publish':
      return {
        ...base,
        plan_id: stringField(bodyRecord, 'plan_id'),
        exec_id: execIdField(bodyRecord),
        task_id: execIdField(bodyRecord),
        case_status: 'STUB_ACCEPTED',
      }
    case '/api/task-report-generate':
      return {
        ...base,
        exec_id: execIdField(bodyRecord),
        task_id: execIdField(bodyRecord),
        task_status: 'PENDING',
        report_status: 'PENDING',
      }
    case '/api/task-manage':
      return {
        ...base,
        exec_id: execIdField(bodyRecord),
        task_id: execIdField(bodyRecord),
        task_operation: stringField(bodyRecord, 'task_operation'),
        task_status: statusForTaskOperation(bodyRecord.task_operation),
      }
    case '/api/user-instruction':
      return {
        ...base,
        plan_id: stringField(bodyRecord, 'plan_id'),
        exec_id: execIdField(bodyRecord),
        task_id: execIdField(bodyRecord),
        message_id: requestId,
        finished: true,
        content: 'Planner API stub accepted the user instruction.',
      }
  }
}

async function writePlannerApiStubLog(entry: Record<string, unknown>) {
  await mkdir(PLANNER_API_STUB_LOG_DIR, { recursive: true })
  await writeFile(
    join(PLANNER_API_STUB_LOG_DIR, `${entry.request_id}.json`),
    `${JSON.stringify(entry, null, 2)}\n`,
    'utf8',
  )
}

export async function handlePlannerApiStubRequest(
  request: Request,
): Promise<Response> {
  const url = new URL(request.url)
  const endpoint = canonicalPlannerApiStubEndpoint(url.pathname)
  if (!endpoint) {
    return jsonApiResponse(apiError(404, 'Not found'), 404)
  }

  const receivedAt = new Date().toISOString()
  const rawBody = await request.text()
  let body: unknown = {}
  let parseError: string | null = null

  try {
    body = rawBody.trim() === '' ? {} : (JSON.parse(rawBody) as unknown)
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error)
  }

  const { requestId, originalRequestId } = pickRequestId(request, body)
  const logBase = {
    request_id: requestId,
    original_request_id: originalRequestId,
    received_at: receivedAt,
    method: request.method,
    path: url.pathname,
    canonical_endpoint: endpoint,
    query: url.search,
    headers: selectedHeaders(request),
    stub: true,
  }

  if (request.method !== 'POST') {
    await writePlannerApiStubLog({
      ...logBase,
      parse_ok: parseError === null,
      validation_ok: false,
      validation_issues: [{ message: 'Method not allowed' }],
      ...(parseError
        ? { parse_error: parseError, raw_body: rawBody }
        : { body }),
    })
    return jsonApiResponse(apiError(405, 'Method not allowed'), 405)
  }

  if (parseError) {
    await writePlannerApiStubLog({
      ...logBase,
      parse_ok: false,
      validation_ok: false,
      parse_error: parseError,
      raw_body: rawBody,
    })
    return jsonApiResponse(apiError(400, 'Invalid JSON body'), 400)
  }

  const validation = validatePlannerApiStubBody(endpoint, body)
  await writePlannerApiStubLog({
    ...logBase,
    parse_ok: true,
    validation_ok: validation.success,
    ...(validation.success ? {} : { validation_issues: validation.issues }),
    body,
  })

  if (!validation.success) {
    return jsonApiResponse(
      apiError(
        400,
        `Invalid planner api stub request: ${JSON.stringify(validation.issues)}`,
      ),
      400,
    )
  }

  return jsonApiResponse(
    apiSuccess(buildPlannerApiStubData(endpoint, requestId, body)),
  )
}
