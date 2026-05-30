# InfTest 主 Agent 接口未实现项清单

> **对照文档：** [InfTest 接口文档智能体代理与主agent](./InfTest%20接口文档智能体代理与主agent.md)  
> **更新日期：** 2026-05-29  
> **代码基线：** `InfTest-Main-Agent` 主 Agent（stateful runner + plannerApiRealHandler）

本文档与对照文档**逐节、逐字段**对齐，标注主 Agent 对每个接口/字段的实现状态：

| 标记 | 含义 |
|------|------|
| ✅ | 已实现且可用于主流程 |
| ⚠️ | 部分实现或与文档/proto 不一致 |
| ❌ | 未实现 |
| ➖ | 非主 Agent 职责 |

---

## 文档章节对照索引

| 对照文档章节 | 路径 / 方向 | 本文档节 |
|-------------|------------|---------|
| 生成计划（Planner Agent Api） | `POST /api/generate-plan`（入站） | [§2.1](#21-生成计划planner-agent-api) |
| 上报任务计划（Proxy Api） | `POST api/proxy-plan-task-submit`（**出站**） | [§2.2](#22-上报任务计划proxy-api) |
| 任务状态上报（Proxy Api） | `POST /api/proxy-update-task-status`（**出站**） | [§2.3](#23-任务状态上报proxy-api) |
| 测试用例生成及计划表下发 | `POST /api/plan-task-publish`（入站） | [§2.4](#24-测试用例生成及计划表下发) |
| 测试用例下发/重启 | `POST /api/case-publish`（入站） | [§2.5](#25-测试用例下发重启) |
| 任务报告生成 | `POST /api/task-report-generate`（入站） | [§2.6](#26-任务报告生成) |
| 设备操作交互（代理服务 API） | `POST /api/cmd-bridge/submit` | [§2.7](#27-设备操作交互) |
| 终止、暂停、继续 | `POST /api/task-manage`（入站） | [§2.8](#28-终止暂停继续) |
| 用户指令注入 | `POST /api/payload`（入站） | [§2.9](#29-用户指令注入) |

---

## 1. 端到端流程（已实现部分）

对照文档描述的 Planner 与代理交互顺序，当前主 Agent **已跑通**的链路：

```text
POST /api/generate-plan
  → 出站 POST api/proxy-plan-task-submit（上报 plan_detail）
POST /api/plan-task-publish
  → 用例生成（DATA_GEN）→ PAUSED，等待用户确认
POST /api/case-publish
  → 设备调度 + 用例执行（EXECUTING）→ PAUSED，等待报告
POST /api/task-report-generate
  → 结果分析（REFLECTING）→ SUCCESS + 报告上传
```

各阶段通过出站 `POST /api/proxy-update-task-status` 上报 Agent 状态（详见 §2.3）。

---

## 2. 按对照文档分节的实现状态

### 2.1 生成计划（Planner Agent Api）

**对照文档：** `POST /api/generate-plan`  
**调用方向：** 智能体代理服务 → 主 Agent（Planner Agent）  
**调用时机：** 代理服务向 planner agent 请求创建计划表

#### 请求体字段（对照文档 JSON，L15–67）

| 字段 | 状态 | 说明 |
|------|------|------|
| `plan_id` | ✅ | 接收并用于落盘/上下文 |
| `plan_name` | ✅ | 传入 LLM / 落盘 |
| `project_id` | ✅ | 传入 LLM / 落盘 |
| `project_name` | ✅ | 落盘；参与 plan_detail 兜底 |
| `prd_file_key` | ⚠️ | 仅作为字符串传入 LLM prompt，**未读取文件内容** |
| `prd_file_url` | ⚠️ | P1：`PrdFetcher` 按 URL 下载至 `input/prd.md`（需可访问 URL） |
| `prd_md_file_key` | ⚠️ | 落盘路径引用；优先 `prd_md_file_url` |
| `prd_md_file_url` | ⚠️ | P1：同 PRD 下载 |
| `plan_images[]` | ❌ | 未解析；多模态未接入 |
| `plan_images[].name/file_key/file_url/sort_order` | ❌ | 同上 |
| `test_env_url` | ✅ | 传入 LLM / 落盘 |
| `test_strategies[]` | ✅ | 驱动 tasks 生成 |
| `remark` | ⚠️ | P1：传入 `LlmPlanGenerator` prompt |
| `plan_config_info` | ⚠️ | P1：落盘 `input/plan_config.json` + 执行超时/用例生成 extra_args |
| `plan_config_info.decup_config` | ❌ | 已落盘，去重逻辑未接子 Agent |
| `plan_config_info.case_generate_info` | ⚠️ | P1：`StaticCaseGenerationSkill` extra_args |
| `plan_config_info.case_execution_info` | ⚠️ | P1：`max_timeout_minutes` → runner 超时秒数 |
| `plan_config_info.device_schedule_info` | ⚠️ | `max_schedule_device_num` 已传入适配器；其余字段待扩展 |
| `plan_config_info.included_worker_nums` | ❌ | 已落盘，未接 worker 池 |
| `plan_config_info.enable_multimodal` | ❌ | 未接多模态 |
| `plan_config_info.llm_model_config_id` | ⚠️ | P1：case gen extra_args |
| `plan_config_info.embedding_model_config_id` | ❌ | 未使用 |
| `plan_config_info.multimodal_model_config_id` | ❌ | 未使用 |

#### 响应（对照文档 Proto `CreateTestPlanResponse`，L84–89）

| 项 | 状态 | 说明 |
|----|------|------|
| `code` / `message` | ✅ | 统一 `{ code, message, data }` 包装 |
| `data` → `TestPlan` 结构 | ❌ | 实际返回自定义 async ACK（`plan_status`、`exec_ids`、`async: true` 等） |

#### 出站副作用

| 行为 | 状态 | 说明 |
|------|------|------|
| 生成后上报 `proxy-plan-task-submit` | ✅ | 见 §2.2 |

**相关代码：** `plannerApiRealHandler.ts` → `handleGeneratePlan`；`LlmPlanGenerator.ts`

---

### 2.2 上报任务计划（Proxy Api）

**对照文档：** `POST api/proxy-plan-task-submit`  
**调用方向：** 主 Agent（Planner Agent）→ 代理服务（**出站**）  
**调用时机：** Planner Agent 生成好任务计划后上报

#### 请求（对照文档 Proto `ReportTestPlanDetailRequest`，L104–108）

| 字段 | 状态 | 说明 |
|------|------|------|
| `plan_id` | ✅ | |
| `plan_detail`（七段 PlanDetail） | ✅ | `test_objectives` … `deliverables` |
| `failure_reason` | ✅ | 失败时上报 |

#### 响应（对照文档 Proto `ReportTestPlanDetailResponse`，L121–125）

| 字段 | 状态 | 说明 |
|------|------|------|
| `plan_id` | ❌ | 未解析响应 |
| `status`（TestPlanStatus） | ❌ | 未解析响应 |
| `message` | ❌ | 未解析响应 |

**备注：** `ProxyClient.reportGeneratedTasks` 为遗留方法，生产流程已由 `reportTestPlanDetail` 替代。

**相关代码：** `ProxyClient.ts` → `reportTestPlanDetail`

---

### 2.3 任务状态上报（Proxy Api）

**对照文档：** `POST /api/proxy-update-task-status`  
**调用方向：** 主 Agent（Planner Agent）→ 代理服务（**出站**）  
**调用时机：** 任务执行中各 Agent 产出由 planner agent 主动上报

#### 请求（对照文档 Proto `UpdateTaskStatusRequest`，L142–151）

| 字段 | 文档名 | 状态 | 说明 |
|------|--------|------|------|
| 任务 ID | `task_id` | ✅ | |
| 智能体 | `agent_name` | ⚠️ | 见下方 AgentName 表 |
| 状态 | `task_status` | ⚠️ | 出站字段名为 **`agent_status`**（联调约定） |
| Token | `total_tokens` | ✅ | |
| 中间产物 | `output_json` | ⚠️ | 部分经 skill telemetry 上报，非全量 |
| 执行日志 | `step_log` | ✅ | |
| 开始时间 | `start_time` | ✅ | |
| 结束时间 | `end_time` | ✅ | |

#### TaskStatus 枚举（对照文档 L153–161）

| 枚举 | 文档值 | 当前出站值 | 状态 |
|------|--------|-----------|------|
| `PENDING` | 0 | 0 | ✅ |
| `CHECK`（待用户确认） | 1 | 1 | ✅ P0：`finishPartial(DATA_GEN)` 上报 CHECK |
| `RUNNING` | 2 | 1 | ⚠️ 编号不一致（联调约定；P2 对齐文档 RUNNING=2） |
| `SUCCESS` | 3 | 3 | ✅ |
| `FAILED` | 4 | 2 | ⚠️ 编号不一致（联调约定） |
| `PAUSED` | 5 | 4 | ⚠️ 编号不一致；**P0：`finishPartial(EXECUTING)` 已上报 PAUSED** |
| `TERMINATED` | 6 | 5 | ⚠️ 编号不一致 |

#### AgentName 枚举（对照文档 L163–169）

| 枚举 | 文档值 | 上报情况 |
|------|--------|---------|
| `CASE_GENERATION_AGENT` | 1 | ✅ DATA_GEN 阶段 |
| `TEST_DATA_AGENT` | 2 | ❌ 流水线无独立阶段，从未上报 |
| `DEVICE_SCHEDULING_AGENT` | 3 | ✅ COORDINATE 阶段 |
| `CASE_EXECUTION_AGENT` | 4 | ✅ EXECUTING 阶段 |
| `RESULT_ANALYSIS_AGENT` | 5 | ✅ REFLECTING 阶段 |

#### 其他缺口

| 项 | 说明 |
|----|------|
| EXECUTING → 等待报告 | ✅ P0：`finishPartial('EXECUTING')` 上报 PAUSED；`applyStatefulRunnerResult` 保留 session |
| Hook 进入阶段上报 | ✅ P0：已移除 `HookManager.reportStage` 重复 proxy 调用 |

**相关代码：** `StatefulRunner.ts`、`updateTaskStatusPayload.ts`、`HookManager.ts`

---

### 2.4 测试用例生成及计划表下发

**对照文档：** `POST /api/plan-task-publish`  
**调用方向：** 智能体代理服务 → 主 Agent  
**调用时机：** 代理服务向 planner 发出测试用例生成请求

#### 请求体字段（对照文档 JSON，L184–254）

| 字段 | 状态 | 说明 |
|------|------|------|
| `plan_id` | ✅ | 必填校验 |
| `plan_name` | ⚠️ | 写入 plan 上下文，未传给 case gen 子 Agent |
| `project_id` | ⚠️ | 写入 plan 上下文 |
| `project_name` | ❌ | 未使用 |
| `prd_file_key` | ⚠️ | 写入上下文，未读内容 |
| `prd_file_url` | ❌ | 未下载 |
| `prd_md_file_key` | ❌ | 未使用 |
| `prd_md_file_url` | ❌ | 未下载 |
| `plan_images[]` | ❌ | 未使用 |
| `test_env_url` | ⚠️ | 写入上下文 / task_detail 兜底 |
| `remark` | ❌ | 未传入子 Agent |
| `plan_config_info`（全量） | ❌ | 未透传 |
| `plan_detail`（七段） | ⚠️ | 仅 `test_target` 写入 `task_detail.json` |
| `tasks[]` | ✅ | 解析并触发 case generation |
| `tasks[].task_id` | ✅ | |
| `tasks[].task_type` | ❌ | 解析 body 时**未读取/未持久化** |

> 注：对照文档此接口 JSON **不含** `test_strategies` 字段（与 generate-plan 不同）。

#### 行为

| 项 | 状态 | 说明 |
|----|------|------|
| 触发用例生成 | ✅ | `scheduleCaseGenerationAsync` |
| 生成完成后 PAUSED | ✅ | `stop_after_stage: DATA_GEN` |
| 出站状态上报 | ⚠️ | 见 §2.3（CHECK vs PAUSED） |

**相关代码：** `plannerApiRealHandler.ts` → `handlePlanTaskPublish`

---

### 2.5 测试用例下发/重启

**对照文档：** `POST /api/case-publish`  
**调用方向：** 智能体代理服务 → 主 Agent  
**调用时机：** 用户确认用例后代理下发；也可作重启

#### 请求体字段（对照文档 JSON，L267–313）

| 字段 | 状态 | 说明 |
|------|------|------|
| `plan_id` | ✅ | |
| `plan_name` | ✅ | 写入 test_cases 元数据 |
| `plan_detail`（七段） | ✅ | `persistPlanDetail` + `task_detail.json` |
| `test_strategies[]` | ⚠️ | 写入 `case_publish_request.json`，**未注入 runner** |
| `test_env_url` | ⚠️ | 写入 request 落盘，**未注入 runner** |
| `plan_config_info` | ✅ | `persistPlanConfig` → `input/plan_config.json` |
| `exec_id` | ✅ | 驱动执行 |
| `cases[]` | ✅ | 校验、转 `test_cases.json` |
| `cases[].case_id` | ✅ | |
| `cases[].title` | ✅ | 映射为 `case_name` |
| `cases[].conditions` | ✅ | 落盘 `conditions` / `preconditions` |
| `cases[].condition` | ✅ | 代理兼容别名（单数） |
| `cases[].steps[]` | ✅ | 含 `step_id`/`action`/`expected`，转 `case_step` |
| `cases[].case_name` / `test_steps` | ✅ | 旧格式向后兼容 |

#### 行为

| 项 | 状态 | 说明 |
|----|------|------|
| 触发 COORDINATE + EXECUTING | ✅ | 2026-05-29 修复 |
| 无会话仅 case-publish（磁盘已有 test_cases） | ✅ | 冷启动 PAUSED@DATA_GEN 后从 COORDINATE 执行 |
| 执行完成后 PAUSED 等报告 | ✅ | `stop_after_stage: EXECUTING` |
| 重启语义 | ✅ | 服务重启后重发 case-publish 即可（需 test_cases 在盘） |
| 生产部署 | ⚠️ | 需 `systemctl restart inftest-main-agent` |

**相关代码：** `casePublishArtifacts.ts`、`handleCasePublish`、`taskExecutionService.ts`

---

### 2.6 任务报告生成

**对照文档：** `POST /api/task-report-generate`  
**调用方向：** 智能体代理服务 → 主 Agent  
**调用时机：** 测试执行结束后代理请求生成报告

#### 请求体字段（对照文档 JSON，L307–345）

| 字段 | 状态 | 说明 |
|------|------|------|
| `plan_id` | ✅ | 落盘 |
| `plan_name` | ✅ | 落盘 |
| `plan_detail` | ⚠️ | 落盘；对报告模板驱动有限 |
| `task_id` | ✅ | 与 `exec_id` 等价解析 |
| `task_name` | ✅ | 落盘 |
| `md_file_key` | ✅ | 写入 `report_requirement.json` |
| `exec_id` | ✅ | 驱动报告任务 |
| `cases[]` | ✅ | 转 `case_result.json` |
| `cases[].case_id/type/case_name/preconditions` | ✅ | |
| `cases[].test_steps[]` | ✅ | |
| `cases[].status` | ✅ | |
| `cases[].execution_result` | ✅ | |
| `cases[].retry_count` | ✅ | |
| `cases[].failure_reason` | ✅ | |
| `cases[].step_log_info[]` | ✅ | |
| `cases[].device_id` | ✅ | |
| `cases[].start_time/end_time` | ✅ | |
| `defects[]` | ✅ | 落盘 |

#### 响应（对照文档 Proto `ConfirmGenerateTaskReportData`，L361–365）

| 字段 | 状态 | 说明 |
|------|------|------|
| `task_id` | ✅ | 响应含 `exec_id` / `task_id` |
| `task_status` | ✅ | |
| `report_status` | ✅ | PENDING/RUNNING/SUCCESS/FAILED 映射 |

#### 行为

| 项 | 状态 | 说明 |
|----|------|------|
| 等待 EXECUTING 完成 | ✅ | |
| 调用 result_analyzer + REFLECTING | ✅ | 2026-05-29 修复 |
| 生产部署 | ⚠️ | 需重启服务 |

**环境变量：** `INFTEST_TASK_REPORT_WAIT_MS=900000`（可选）

**相关代码：** `taskReportGenerateArtifacts.ts`、`handleTaskReportGenerate`、`runReportGenerationJob`

---

### 2.7 设备操作交互

**对照文档：** `POST {ip}/api/cmd-bridge/submit`  
**调用方向：** 执行 Agent → 代理服务  
**调用时机：** 执行 agent 操控设备前发送 payload

| 项 | 状态 |
|----|------|
| 主 Agent 实现 | ➖ **非主 Agent 职责** |

执行 Agent 直连代理；主 Agent 不实现此接口。参见 [InfTest 主 Agent 接口交互专用文档](./InfTest_主Agent接口交互专用文档.md)。

---

### 2.8 终止、暂停、继续

**对照文档：** `POST /api/task-manage`（计划力度）  
**调用方向：** 智能体代理服务 → 主 Agent

#### 请求（对照文档 Markdown L415–418 / Thrift L422–425）

| 字段 | 状态 | 说明 |
|------|------|------|
| `exec_id`（文档 Markdown 示例） | ✅ | 也支持 `task_id` |
| `task_operation: PAUSE` | ✅ | |
| `task_operation: CONTINUE` | ✅ | |
| `task_operation: TERMINATION` | ✅ | 内部映射 `TERMINATE` |
| `task_operation: START` | ✅ | Thrift 有定义；**文档 Markdown 示例未列**，主 Agent 额外支持 |
| `task_operation: RESTART` | ✅ | 主 Agent 额外支持，文档未列 |

#### 响应（Thrift `TaskResponse.message`）

| 项 | 状态 |
|----|------|
| 返回 `message` | ✅ |

**语义待确认：** 对照文档标题写「计划力度」，当前实现为 **exec/task 粒度**控制。

---

### 2.9 用户指令注入

**对照文档：** `POST /api/payload`  
**调用方向：** 智能体代理服务 → 主 Agent

#### 请求体（对照文档 JSON，L443–465）

| 字段 | 状态 | 说明 |
|------|------|------|
| `plan_id` | ✅ | 计划修订路径以 `plan_id` 为主键 |
| `user_instruction` | ✅ | 驱动 `revisePlanWithLlm` |
| `plan_detail`（七段） | ✅ | 作为修订基准；完成后上报代理 |
| `plan_qa_list[]` | ✅ | 注入修订 prompt |
| `plan_qa_list[].question/answer` | ✅ | 同上 |

#### 流式响应（对照文档 Proto `ChatStreamResponse` / `ChatStreamData`，L478–490）

| 字段 | 状态 | 说明 |
|------|------|------|
| `code` / `message` | ✅ | SSE envelope 含 |
| `data.task_id` | ✅ | |
| `data.chunk` | ✅ | 计划修订时流式输出 `revision_summary` 文本 |
| `data.finished` | ✅ | |
| `data.message_id` | ✅ | |

#### ChatStreamRequest（对照文档 L471–475，经 `/tasks/chat/stream`）

| 字段 | 状态 | 说明 |
|------|------|------|
| `user_id` | ✅ | `/api/payload` 转发时可传 |
| `task_id` | ✅ | |
| `user_instruction` | ⚠️ | 只读问答，非改计划 |

#### 与对照文档的差异

| 项 | 说明 |
|----|------|
| 文档意图 | 用户指令 + plan_detail + plan_qa_list → **修订测试计划** |
| 当前实现 | Chat 为只读任务状态助手（`InfTestChatStreamer` 禁止调工具、禁止改计划） |
| 额外入口 | 代码中存在 `/api/user-instruction`（**对照文档未列**），仅存上下文未被 runner 消费 |
| 双路径 | `taskApi` SSE 路径优先；`plannerApiRealHandler.handlePayload` 为非流式 stub |

**相关代码：** `taskApi.ts`、`InfTestChatStreamer.ts`、`plannerApiRealHandler.ts`

---

## 3. 跨节共性缺口（优先级）

### P0 — 联调可见性

1. ~~重启 `inftest-main-agent`（case-publish / task-report-generate 修复生效）~~ — 部署操作，见 §5.11
2. ~~EXECUTING 完成后出站上报 PAUSED（§2.3）~~ — **已实现**（`StatefulRunner.finishPartial` + `applyStatefulRunnerResult`）
3. ~~CHECK vs PAUSED 语义~~ — **已实现**：DATA_GEN 完成 → CHECK(1)；EXECUTING 完成 → PAUSED(4)
4. 代理 → 后端连通（502 等环境项）

### P1 — 对照文档字段落地

5. ~~`plan_config_info` 全链路透传~~ — **已实现基础版**（落盘 + 超时 + case gen extra_args；去重/设备/worker 待补）
6. ~~PRD 下载~~ — **已实现**（`PrdFetcher.ts`；依赖 URL 可达）
7. ~~`/api/payload` 计划修订~~ — **已实现**（`planRevisionStream.ts` + `LlmPlanReviser.ts`；需 `OPENAI_API_KEY`）

### P2 — Proto / 枚举对齐

8. `task_status` 字段名与枚举编号（§2.3）
9. `generate-plan` 响应 `CreateTestPlanResponse`（§2.1）
10. `TEST_DATA_AGENT` 去留（§2.3）
11. ~~`HookManager.reportStage` 补全状态（§2.3）~~ — **已实现**（移除重复 proxy 上报）

### P3 — 增强

12. `plan_images` + `enable_multimodal`（§2.1、§2.4）
13. `remark`（§2.1、§2.4）
14. `tasks[].task_type` 持久化（§2.4）
15. Dead code：`reportGeneratedTasks`、`/api/user-instruction` stub

---

## 5. 应该怎样实现

本节与 §2 逐节对应，说明**推荐实现方式**、涉及文件与验收标准。P0 项已在代码中落地；P1/P2 仅给出设计指引。

### 5.1 生成计划（§2.1）

**目标：** PRD 驱动 LLM、`plan_config_info` 落盘、响应对齐 `CreateTestPlanResponse`。

**实现步骤：**

1. 新增 [`src/inftest/adapters/PrdFetcher.ts`](../src/inftest/adapters/PrdFetcher.ts)：优先 `prd_md_file_url`，fallback `prd_file_url`；重试 2 次；写入 `input/prd.md`。
2. 新增 [`src/inftest/schemas/planConfig.ts`](../src/inftest/schemas/planConfig.ts)：`PlanConfigInfoSchema`（对齐 `API_CONTRACT.md`）。
3. [`handleGeneratePlan`](../src/inftest/server/plannerApiRealHandler.ts)：解析 config → 写入 `planner-real/{planId}/plan_detail.json`；每 task 预热时写 `input/plan_config.json`。
4. [`LlmPlanGenerator.ts`](../src/inftest/LlmPlanGenerator.ts)：prompt 注入 `prd_content`、`remark`。
5. 新增 `buildGeneratePlanResponse()`：返回 contract 形 `TestPlan`（保留 `async: true` 扩展字段时可加 env 开关）。

**验收：** `POST /api/generate-plan` 后 workspace 含 `input/prd.md`、`input/plan_config.json`；LLM prompt 含 PRD 摘要。

---

### 5.2 上报任务计划（§2.2）

**目标：** 解析代理响应；清理遗留 API。

**实现步骤：**

1. [`ProxyClient.reportTestPlanDetail`](../src/inftest/adapters/ProxyClient.ts)：解析 `plan_id`、`status`、`message`；失败时 log + 可选重试。
2. 删除或标记 deprecated [`reportGeneratedTasks`](../src/inftest/adapters/ProxyClient.ts)（生产未调用）。

**验收：** 联调日志可见 `proxy.report_test_plan_detail` 响应体 parsed fields。

---

### 5.3 任务状态上报（§2.3）

**P0 已实现：**

| 场景 | 内部 session | 代理 `agent_status` | 代码位置 |
|------|-------------|---------------------|---------|
| DATA_GEN 完成，等 case-publish | `PAUSED` @ DATA_GEN | **CHECK (1)** | `StatefulRunner.finishPartial` + `mapPartialStopProxyStatus` |
| EXECUTING 完成，等 task-report-generate | `PAUSED` @ EXECUTING | **PAUSED (4)** | 同上 + `ExecutionResultWatcher` |
| 用户/system 暂停 | `PAUSED` | PAUSED | 现有 `task-manage` |

**关键模块：**

- [`updateTaskStatusPayload.ts`](../src/inftest/adapters/updateTaskStatusPayload.ts)：`ProxyAgentStatus`、`proxy_status` 字段、`mapPartialStopProxyStatus()`
- [`applyStatefulRunnerResult`](../src/inftest/TaskSessionManager.ts)：partial stop 不 `finish()` 为 SUCCESS
- [`HookManager.ts`](../src/inftest/HookManager.ts)：移除重复 `reportStage` proxy 调用

**P2 待做：** 枚举全量对齐文档（RUNNING=2 等）；`TEST_DATA_AGENT` 策略（独立阶段或文档声明合并）。

**验收：**

```bash
# 单测
bun test src/inftest/__tests__/updateTaskStatusPayload.test.ts
bun test src/inftest/__tests__/applyStatefulRunnerResult.test.ts

# 联调日志
journalctl -u inftest-main-agent -f | grep -E 'report_task_update|stopped_after_stage'
# plan-task-publish 后 agent_status=1 (CHECK)
# case-publish 执行完成后 agent_status=4 (PAUSED)
```

---

### 5.4 测试用例生成下发（§2.4）

**目标：** 请求体 rich 字段透传到 case gen 子 Agent。

**实现步骤：**

1. 新增 `persistPlanPublishContext(taskId, body)`：写 `input/plan_config.json`、`input/plan_detail.json`、`input/tasks.json`（含 `task_type`）。
2. [`handlePlanTaskPublish`](../src/inftest/server/plannerApiRealHandler.ts)：对每个 task 调用上述 persist；[`PrdFetcher`](../src/inftest/adapters/PrdFetcher.ts) 若 workspace 无 PRD 则下载。
3. [`StaticCaseGenerationSkill`](../src/inftest/skills/StaticCaseGenerationSkill.ts)：读 `plan_config.json` → `SubAgentAdapter.invoke(..., extra_args)`。

**验收：** `plan-task-publish` 后 `{workspace}/input/plan_config.json` 与请求体一致；case gen 子进程 argv 含 config 派生参数。

---

### 5.5 测试用例下发/重启（§2.5）

**目标：** `plan_config_info` / `test_env_url` 注入 runner。

**实现步骤：**

1. 新增 `loadPlanConfig(workspace)` helper。
2. [`handleCasePublish`](../src/inftest/server/plannerApiRealHandler.ts)：persist 后写 `input/plan_config.json`（若 body 含 config）。
3. [`createDefaultSkillRegistry`](../src/inftest/skills/index.ts) / [`ExecutionSkill`](../src/inftest/skills/ExecutionSkill.ts)：读 config 设置 `timeout_seconds`、`max_case_retry_num`。

**验收：** case-publish 后 execution 超时与 config 中 `max_timeout_minutes` 一致。

---

### 5.6 任务报告生成（§2.6）

**目标：** 已基本完成；增强 `plan_detail` 驱动报告模板。

**实现步骤：**

1. [`taskReportGenerateArtifacts.ts`](../src/inftest/server/taskReportGenerateArtifacts.ts)：将 `plan_detail` 写入 `input/report_requirement.json` 结构化字段。
2. [`inftest_real_report_agent_adapter.py`](../scripts/inftest_real_report_agent_adapter.py)：读取 plan_detail 段落作为报告上下文。

**验收：** `task-report-generate` 全流程 SUCCESS；`analysis/report.md` 存在。

---

### 5.7 设备操作交互（§2.7）

**不实现。** 执行 Agent 直连代理 `cmd-bridge/submit`。

---

### 5.8 终止、暂停、继续（§2.8）

**当前：** exec/task 粒度 PAUSE/CONTINUE/TERMINATION/START/RESTART 已实现。

**待产品确认：** 文档标题「计划力度」是否需 plan_id 级批量控制；若需要，在 [`handleTaskManage`](../src/inftest/server/plannerApiRealHandler.ts) 按 `planContexts` 遍历 `task_ids`。

---

### 5.9 用户指令注入（§2.9）

**目标：** 与只读 Chat 分离，实现计划修订。

**实现步骤：**

1. 新增 `PlanRevisionStreamer`（或扩展 [`LlmPlanGenerator`](../src/inftest/LlmPlanGenerator.ts)）：输入 `plan_detail` + `plan_qa_list` + `user_instruction` → 流式输出修订后 plan sections。
2. [`handleApiPayloadStream`](../src/inftest/server/taskApi.ts)：若 body 含 `plan_detail` / `plan_qa_list` → 走 revision SSE；否则保留现有只读 Chat。
3. 修订完成：[`reportPlanDetailAsync`](../src/inftest/server/plannerApiRealHandler.ts) + 更新 `planner-real/{planId}/plan_detail.json`。
4. 废弃 [`handlePayload`](../src/inftest/server/plannerApiRealHandler.ts) stub 或 delegate 到同一 reviser。

**验收：** `POST /api/payload` SSE chunk 含修订后的 plan 段落；代理收到更新后的 `plan_detail`。

---

### 5.10 P1/P2/P3 分期与验收

| 优先级 | 项 | 涉及文件 | 验收 |
|--------|-----|---------|------|
| P1 | PRD 下载 | `PrdFetcher.ts`, `LlmPlanGenerator.ts` | workspace 含 `input/prd.md` |
| P1 | plan_config 全链路 | `planConfig.ts`, skills, `SubAgentAdapter` | 子 Agent argv 含 config |
| P1 | `/api/payload` 改计划 | `PlanRevisionStreamer`, `taskApi.ts` | SSE 输出 plan diff |
| P2 | 枚举对齐文档 | `updateTaskStatusPayload.ts` | 与代理确认 RUNNING=2 |
| P2 | generate-plan 响应 | `plannerApiRealHandler.ts` | 响应含 `TestPlan` 结构 |
| P2 | TEST_DATA_AGENT | `StatefulRunner` 或文档 | 明确合并或独立阶段 |
| P3 | 多模态 | `LlmPlanGenerator`, case gen | `plan_images` 传入 LLM |
| P3 | dead code | `ProxyClient`, `handlePayload` | 无重复入口 |

---

### 5.11 部署（P0 代码生效）

```bash
sudo systemctl restart inftest-main-agent
curl -s http://127.0.0.1:8787/health
```

---

## 6. 不属于主 Agent 未实现

| 项 | 说明 |
|----|------|
| 用例生成子 Agent 失败 | 如 `REAL_CASE_GENERATION_REQUIRED` |
| 代理后端不可达 | 部署/网络 |
| `cmd-bridge/submit` | 执行 Agent 职责（§2.7） |

---

## 7. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-05-29 | 初版 |
| 2026-05-29 | 修订：与对照文档逐节、逐字段对齐；修正 plan-task-publish 误列 `test_strategies`；补充 Proto/枚举对照表 |
| 2026-05-29 | 新增 §5「应该怎样实现」；P0 代码：CHECK/PAUSED 代理上报、`applyStatefulRunnerResult`、HookManager 清理 |
| 2026-05-30 | P1 实现：`PrdFetcher`、`planContextArtifacts`、`planRevisionStream`、`LlmPlanReviser`；config/PRD/payload 基础落地 |
