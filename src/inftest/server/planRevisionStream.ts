import { randomUUID } from 'crypto'
import { chunkRevisionText, revisePlanWithLlm } from '../LlmPlanReviser.js'
import { ProxyClient } from '../adapters/ProxyClient.js'
import type { PlanDetailInfo } from '../adapters/ProxyClient.js'
import { API_CODE_SUCCESS } from './apiResponse.js'
import {
  loadPlanDetailFromPlanId,
  parsePlanDetailFromBody,
  parsePlanQaList,
  persistPlanLevelDetail,
} from './planContextArtifacts.js'

export type PlanRevisionStreamInput = {
  plan_id: string
  user_instruction: string
  plan_detail?: PlanDetailInfo | null
  plan_qa_list?: ReturnType<typeof parsePlanQaList>
  request_id?: string | null
}

function formatSse(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

function resolveBasePlanDetail(
  input: PlanRevisionStreamInput,
): PlanDetailInfo | null {
  if (input.plan_detail) return input.plan_detail
  return loadPlanDetailFromPlanId(input.plan_id)
}

export function isPlanRevisionPayload(
  record: Record<string, unknown>,
): boolean {
  const planId =
    typeof record.plan_id === 'string' && record.plan_id.trim()
      ? record.plan_id.trim()
      : null
  const instruction =
    typeof record.user_instruction === 'string' &&
    record.user_instruction.trim()
      ? record.user_instruction.trim()
      : null
  if (!planId || !instruction) return false
  const hasDetail =
    record.plan_detail &&
    typeof record.plan_detail === 'object' &&
    !Array.isArray(record.plan_detail)
  const hasQa =
    Array.isArray(record.plan_qa_list) && record.plan_qa_list.length > 0
  return Boolean(hasDetail || hasQa)
}

export async function handlePlanRevisionStream(
  input: PlanRevisionStreamInput,
): Promise<Response> {
  const messageId = input.request_id ?? randomUUID()
  const baseDetail = resolveBasePlanDetail(input)
  if (!baseDetail) {
    return new Response(
      formatSse({
        code: 404,
        message: `plan_detail not found for plan_id ${input.plan_id}`,
        data: {
          plan_id: input.plan_id,
          task_id: input.plan_id,
          chunk: '',
          finished: true,
          message_id: messageId,
        },
      }),
      {
        status: 404,
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      },
    )
  }

  const revised = await revisePlanWithLlm({
    plan_id: input.plan_id,
    user_instruction: input.user_instruction,
    current_plan_detail: baseDetail,
    plan_qa_list: input.plan_qa_list,
  })

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (!revised) {
        const fallback =
          '无法调用模型修订计划（请配置 OPENAI_API_KEY）。当前计划未变更。'
        for (const chunk of chunkRevisionText(fallback)) {
          controller.enqueue(
            encoder.encode(
              formatSse({
                code: API_CODE_SUCCESS,
                message: 'success',
                data: {
                  plan_id: input.plan_id,
                  task_id: input.plan_id,
                  chunk,
                  finished: false,
                  message_id: messageId,
                },
              }),
            ),
          )
        }
        controller.enqueue(
          encoder.encode(
            formatSse({
              code: API_CODE_SUCCESS,
              message: 'success',
              data: {
                plan_id: input.plan_id,
                task_id: input.plan_id,
                chunk: '',
                finished: true,
                message_id: messageId,
              },
            }),
          ),
        )
        controller.close()
        return
      }

      persistPlanLevelDetail(input.plan_id, revised.plan_detail)
      void new ProxyClient()
        .reportTestPlanDetail({
          plan_id: input.plan_id,
          plan_detail: revised.plan_detail,
          failure_reason: '',
        })
        .catch(() => {
          /* non-blocking */
        })

      const chunks = chunkRevisionText(revised.summary_markdown)
      for (const chunk of chunks) {
        controller.enqueue(
          encoder.encode(
            formatSse({
              code: API_CODE_SUCCESS,
              message: 'success',
              data: {
                plan_id: input.plan_id,
                task_id: input.plan_id,
                chunk,
                finished: false,
                message_id: messageId,
              },
            }),
          ),
        )
      }
      controller.enqueue(
        encoder.encode(
          formatSse({
            code: API_CODE_SUCCESS,
            message: 'success',
            data: {
              plan_id: input.plan_id,
              task_id: input.plan_id,
              chunk: '',
              finished: true,
              message_id: messageId,
              plan_detail: revised.plan_detail,
            },
          }),
        ),
      )
      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
}

export function planRevisionInputFromRecord(
  record: Record<string, unknown>,
  requestId: string | null,
): PlanRevisionStreamInput | null {
  const planId =
    typeof record.plan_id === 'string' && record.plan_id.trim()
      ? record.plan_id.trim()
      : null
  const userInstruction =
    typeof record.user_instruction === 'string' &&
    record.user_instruction.trim()
      ? record.user_instruction.trim()
      : null
  if (!planId || !userInstruction) return null
  return {
    plan_id: planId,
    user_instruction: userInstruction,
    plan_detail: parsePlanDetailFromBody(record),
    plan_qa_list: parsePlanQaList(record),
    request_id: requestId,
  }
}
