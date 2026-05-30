# InfTest P1 实现说明（PRD / plan_config / payload 改计划）

> 对照：[InfTest 接口文档智能体代理与主agent](./InfTest%20接口文档智能体代理与主agent.md)  
> 缺口跟踪：[InfTest_主Agent接口未实现项清单](./InfTest_主Agent接口未实现项清单.md)

## 1. 架构总览

```text
代理 POST /api/generate-plan | plan-task-publish | case-publish
        │
        ▼
planContextArtifacts ──► input/plan_config.json
                    ──► input/plan_detail.json
                    ──► input/prd.md          ◄── PrdFetcher
                    ──► input/task_meta.json

代理 POST /api/payload (plan_detail + plan_qa_list)
        │
        ▼
planRevisionStream ──► LlmPlanReviser ──► SSE chunk
                    └──► proxy-plan-task-submit (修订后 plan_detail)
```

## 2. 模块与文档章节对应

| 模块 | 路径 | 文档章节 |
|------|------|---------|
| `PrdFetcher` | `src/inftest/adapters/PrdFetcher.ts` | generate-plan / plan-task-publish 的 `prd_*_url` |
| `PlanConfigInfoSchema` | `src/inftest/schemas/planConfig.ts` | 各接口 `plan_config_info` |
| `planContextArtifacts` | `src/inftest/server/planContextArtifacts.ts` | 落盘与加载 |
| `LlmPlanGenerator`（扩展） | `src/inftest/LlmPlanGenerator.ts` | `remark` + PRD 正文 |
| `LlmPlanReviser` | `src/inftest/LlmPlanReviser.ts` | payload 改计划 |
| `planRevisionStream` | `src/inftest/server/planRevisionStream.ts` | `POST /api/payload` SSE |

## 3. 行为说明

### 3.1 PRD 下载

- 优先 `prd_md_file_url`，否则 `prd_file_url`。
- 写入 `{workspace}/input/prd.md`，`generate-plan` 时同时写入 `planner-real/{planId}/`。
- `LlmPlanGenerator` 使用 `prd_content`（截断 80k 字符）。
- URL 不可达时跳过，不阻断接口（与原先无 PRD 行为兼容）。

### 3.2 plan_config_info 透传

- 解析：`parsePlanConfigInfo(body.plan_config_info)`。
- 落盘：任务 workspace `input/plan_config.json`；计划级 `planner-real/{planId}/plan_config.json`（generate-plan）。
- **已接通：**
  - `case_execution_info.max_timeout_minutes` → `readAvailableTimeoutSeconds(taskId)` / `StatefulRunner`。
  - `case_generate_info` → `StaticCaseGenerationSkill` → `SubAgentAdapter.extra_args`（`max-depth`、`max-cases` 等）。
- **未接通（后续）：** `decup_config`、`device_schedule_info`、`included_worker_nums`、多模态。

### 3.3 /api/payload 计划修订

- 路由：`taskApi.handleApiPayloadStream` 在存在 `plan_id` + `user_instruction` + (`plan_detail` 或 `plan_qa_list`) 时走修订流，**不再要求 exec_id**。
- 无 `plan_detail`/`plan_qa_list` 时仍走原只读 Chat（需 exec_id）。
- 修订完成：写 `planner-real/{planId}/plan_detail.json`，并 `reportTestPlanDetail`。
- 需配置 `OPENAI_API_KEY`；无 key 时 SSE 返回说明性 fallback。

## 4. 验收

```bash
# 单测
bun test src/inftest/__tests__/planContextArtifacts.test.ts
bun test src/inftest/__tests__/planRevisionStream.test.ts

# 类型检查
bun run typecheck

# 部署
sudo systemctl restart inftest-main-agent
```

### 4.1 generate-plan（PRD + config）

```bash
curl -s -X POST http://127.0.0.1:8787/api/generate-plan \
  -H 'Content-Type: application/json' \
  -d @fixtures/generate-plan-with-prd.json
# 检查 .inftest-workspace/planner-real/{planId}/prd.md（若 URL 可达）
# 检查各 task workspace input/plan_config.json
```

### 4.2 plan-task-publish

确认 `{task_id}/input/plan_config.json`、`plan_detail.json`、`prd.md` 存在。

### 4.3 payload 改计划

```bash
curl -N -X POST http://127.0.0.1:8787/api/payload \
  -H 'Content-Type: application/json' \
  -d '{
    "plan_id": "plan-xxx",
    "user_instruction": "补充验证码登录异常场景",
    "plan_detail": { "test_objectives": "...", "test_scope": "..." },
    "plan_qa_list": []
  }'
```

期望：SSE `data.chunk` 为修订说明；最后一条 `finished: true` 可含 `plan_detail`。

## 5. 已知限制

- PRD / LLM 依赖外网与 API Key。
- `plan_images`、去重、设备调度配置尚未接入子 Agent。
- payload 仅 `taskApi` 路径支持修订；`plannerApiRealHandler.handlePayload` 仍为旧 stub（生产流量走 taskApi 优先）。
