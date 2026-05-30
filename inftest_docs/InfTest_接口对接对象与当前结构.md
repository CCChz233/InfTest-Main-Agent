# InfTest 接口对接对象与当前结构

> 日期：2026-05-28  
> 目的：明确现在应该和谁对接口、各方边界是什么、当前主 Agent 有哪些入口和运行结构。  
> 当前推荐联调模式：`INFTEST_RUNNER=stateful`。

> 2026-05-28 字段更新：对外 HTTP 请求统一使用 `exec_id` 作为执行任务标识；代码内部和部分历史文档中的 `task_id` 暂时作为兼容别名保留。
>
> 2026-05-29 口径更新：`/api/*` 已全量 real 化，成功语义为“已受理”，不再是 stub 固定成功返回。

## 1. 你现在应该和谁对接口

优先级从高到低：

| 对接对象 | 是否直接对主 Agent | 你要对什么 | 当前目标 |
|---|---:|---|---|
| 智能体代理服务 Agent Service | 是 | HTTP API | 对主 Agent base URL、`/api/*` real（异步受理）、`/tasks/alter`、`/tasks/{task_id}` |
| 执行 Agent / `gui-tester` 负责人 | 不是平台 HTTP，但必须联调 | CLI + 本地 API | 确认 `front/api_server.py`、`run_API.py`、`API_PORT`、设备或设备 mock |
| 报告 Agent 负责人 | 不是平台 HTTP，但必须联调 | CLI + 模型配置 | 确认 `run_report.py`、需求文档、模型服务 `.env` |
| 模型服务 / 模型网关负责人 | 间接依赖 | OpenAI-compatible API | 确认报告 Agent 的 `BASE_URL`、`MODEL`、`API_KEY` 可用 |
| 后端云服务 | 不直接对主 Agent | 通过 Agent Service 转发 | 确认它是否只调用 Agent Service，不直接打主 Agent |
| 前端 Web Client | 不直接对主 Agent | 无直接接口 | 前端通过后端和 Agent Service 间接触发 |
| 设备服务 / 设备云 | 不直接对主 Agent | 执行 Agent 内部调用 | 主 Agent 不直接点击、截图、读 UI 树 |

当前最应该找的人：

1. **智能体代理服务负责人**：确认他们调用主 Agent 的 base URL 和 HTTP 请求体。
2. **执行 Agent 负责人**：确认服务器 `gui-tester` 能启动，`API_PORT` 可访问，有真实设备或允许 `INFTEST_MOCK_DEVICE=1`。
3. **报告 Agent / 模型服务负责人**：确认报告 Agent 的模型服务可访问，否则链路会卡在 `Connection error`。

## 2. 当前系统关系

主 Agent 在平台里的位置：

```text
前端 Web Client
  -> 后端云服务
  -> 智能体代理服务 Agent Service
  -> InfTest 主 Agent / Planner Agent
  -> CLI 子 Agent
      -> gui-tester / run_API.py
      -> inftest-report-agent / run_report.py
```

重要边界：

- 主 Agent 的 HTTP 直接对接对象只有 **智能体代理服务 Agent Service**。
- 主 Agent 不直接对前端。
- 主 Agent 不直接对后端云服务。
- 主 Agent 不直接对设备服务。
- 主 Agent 通过 CLI 调子 Agent，不把子 Agent 代码合并进主 Agent。

## 3. 当前服务器上应该有哪些结构

建议服务器目录：

```text
/root/InfTest-Main-Agent
/root/gui-tester
/root/inftest-report-agent
/root/docs/requirements.docx
```

也可以不是 `/root`，但必须通过环境变量告诉主 Agent：

```text
INFTEST_EXECUTION_AGENT_CWD=<server gui-tester path>
INFTEST_EXECUTION_AGENT_PYTHON=<server python path>
INFTEST_REPORT_AGENT_CWD=<server report-agent path>
INFTEST_REPORT_AGENT_PYTHON=<server python path>
INFTEST_REQUIREMENT_DOC=<server requirement doc path>
API_PORT=<gui-tester api port>
```

## 4. 当前主 Agent 代码结构

主 Agent 里和对接口最相关的结构：

```text
scripts/inftest_task_api.ts
  -> HTTP 服务入口

src/inftest/server/taskApi.ts
  -> /health
  -> /tasks/alter
  -> /tasks/terminate
  -> /tasks/{task_id}
  -> /tasks/chat/stream
  -> 转发 /api/* 到 plannerApiStub

src/inftest/server/plannerApiStub.ts
  -> Planner /api/* stub
  -> 请求校验
  -> 请求落盘
  -> 返回 code=0

src/inftest/StatefulRunner.ts
  -> stateful runner 主流程

src/inftest/InfTestStateMachine.ts
  -> START / ADVANCE / FAIL / PAUSE / CONTINUE / TERMINATE 状态转移

src/inftest/skills/
  -> PlanSkill
  -> StaticCaseGenerationSkill
  -> DeviceCoordinateSkill
  -> ExecutionSkill
  -> ReportSkill
  -> FinalizeSkill

src/inftest/HookManager.ts
  -> experiment/state_transitions.jsonl
  -> experiment/skill_invocations.jsonl
  -> experiment/hooks.jsonl

scripts/inftest_real_execution_agent_adapter.py
  -> 调 gui-tester/run_API.py

scripts/inftest_real_report_agent_adapter.py
  -> 调 inftest-report-agent/run_report.py
```

## 5. 对 Agent Service 的 HTTP 接口

给智能体代理服务的 base URL：

```text
http://<server-host>:8787
```

### 5.1 健康检查

```http
GET /health
```

成功响应：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "status": "ok"
  }
}
```

### 5.2 Planner API stub

这些接口是当前和智能体代理服务对 HTTP 合同用的接口。

```text
POST /api/generate-plan
POST /api/plan-task-publish
POST /api/case-publish
POST /api/task-report-generate
POST /api/task-manage
POST /api/user-instruction
POST /api/payload
```

成功标准：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "accepted": true,
    "stub": true
  }
}
```

当前行为：

- 解析 JSON。
- 做基础字段校验。
- 写请求日志。
- 返回 `code=0`。
- 不触发真实执行链路。

日志目录：

```text
.inftest-workspace/planner-api-stub/
```

特别注意：

```text
POST /api/task-manage
```

当前仍是 stub。即使传：

```json
{
  "task_id": "task-001",
  "task_operation": "START"
}
```

也不会真正启动任务。

### 5.3 真实任务启动接口

真正启动主 Agent 执行链路要用：

```http
POST /tasks/alter
```

请求：

```json
{
  "task_id": "task-server-001",
  "task_operation": "START"
}
```

当前推荐启动参数：

```bash
INFTEST_RUNNER=stateful
```

成功时关键字段：

```json
{
  "code": 0,
  "data": {
    "task_id": "task-server-001",
    "task_status": "SUCCESS",
    "runner": "stateful",
    "run_fake_e2e_invoked": false
  }
}
```

如果报告模型不可用，当前常见失败：

```text
Report agent exited with code 1. 错误: 模型调用失败：Connection error.
```

这通常说明：

- 主 Agent 已启动。
- stateful runner 已执行。
- 执行 Agent CLI 已跑过。
- `case_result.json` / `summary.json` 多半已经生成。
- 剩余问题在报告 Agent 模型服务。

### 5.4 查询任务状态

```http
GET /tasks/{task_id}
```

重点看：

```text
task_status
runner
current_stage
previous_stage
blocking_reason
last_error
run_fake_e2e_invoked
artifacts
stage_history
```

上线联调时应该确认：

```text
runner = stateful
run_fake_e2e_invoked = false
```

### 5.5 暂停、继续、终止

当前已有基础接口：

```http
POST /tasks/alter
```

请求：

```json
{
  "task_id": "task-server-001",
  "task_operation": "PAUSE"
}
```

```json
{
  "task_id": "task-server-001",
  "task_operation": "CONTINUE"
}
```

终止接口：

```http
POST /tasks/terminate
```

请求：

```json
{
  "task_id": "task-server-001"
}
```

注意：当前暂停 / 继续是 MVP 状态控制，不等于可以热更新正在执行中的子 Agent 输入。

## 6. 主 Agent 主动回调结构

设计上主 Agent 会向智能体代理服务回调：

```text
任务阶段状态
测试计划详情
报告文件
最终结果
```

当前部署联调优先以主 Agent 本地状态和 workspace 产物为准：

```http
GET /tasks/{task_id}
```

以及：

```text
.inftest-workspace/<task_id>/
```

如果 Agent Service 已经提供回调地址，需要确认：

```text
INFTEST_PROXY_BASE_URL
INFTEST_PROXY_TASK_REPORT_PATH
```

当前未把回调作为第一优先验收项，先跑通 `POST /tasks/alter START` 的主链路。

## 7. 对执行 Agent 的结构

主 Agent 不通过 HTTP 直接找设备服务，而是通过 CLI 调执行 Agent：

```text
scripts/inftest_real_execution_agent_adapter.py
  -> gui-tester/run_API.py
  -> gui-tester/front/api_server.py
  -> 设备 / 设备 mock
```

主 Agent 启动时需要：

```bash
API_PORT=<gui-tester api port>
INFTEST_EXECUTION_AGENT_CWD=<server gui-tester path>
INFTEST_EXECUTION_AGENT_PYTHON=<server python path>
```

`gui-tester` 需要先启动：

```bash
cd <server gui-tester path>

API_PORT=<gui-tester api port> \
INFTEST_MOCK_DEVICE=1 \
<server python path> \
front/api_server.py
```

主 Agent 实际 CLI 调用形态：

```bash
<server python path> run_API.py \
  --case <workspace>/execution/inputs/test_cases.md \
  --json <workspace>/execution/results/case_result.json
```

执行成功后应该生成：

```text
.inftest-workspace/<task_id>/execution/results/case_result.json
.inftest-workspace/<task_id>/execution/results/summary.json
```

## 8. 对报告 Agent 的结构

主 Agent 通过 CLI 调报告 Agent：

```text
scripts/inftest_real_report_agent_adapter.py
  -> inftest-report-agent/run_report.py
  -> 模型服务
```

主 Agent 启动时需要：

```bash
INFTEST_REPORT_AGENT_CWD=<server report-agent path>
INFTEST_REPORT_AGENT_PYTHON=<server python path>
INFTEST_REQUIREMENT_DOC=<server requirement doc path>
```

报告 Agent 自己还需要可用模型配置，通常在：

```text
<server report-agent path>/.env
```

重点字段：

```text
BASE_URL=<openai-compatible base url>
MODEL=<model name>
API_KEY=<api key>
```

报告成功后应该生成：

```text
.inftest-workspace/<task_id>/analysis/report.md
.inftest-workspace/<task_id>/analysis/result.json
```

当前最常见失败：

```text
模型调用失败：Connection error.
```

## 9. 当前 workspace 产物结构

每个任务一个目录：

```text
.inftest-workspace/<task_id>/
```

关键结构：

```text
.inftest-workspace/<task_id>/plan.json
.inftest-workspace/<task_id>/case_generation/test_cases.json
.inftest-workspace/<task_id>/device_scheduling/device_case_bind.json
.inftest-workspace/<task_id>/device_scheduling/device_bindings.json
.inftest-workspace/<task_id>/execution/inputs/test_cases.md
.inftest-workspace/<task_id>/execution/results/case_result.json
.inftest-workspace/<task_id>/execution/results/summary.json
.inftest-workspace/<task_id>/execution/result.json
.inftest-workspace/<task_id>/analysis/result.json
.inftest-workspace/<task_id>/analysis/report.md
.inftest-workspace/<task_id>/experiment/state_transitions.jsonl
.inftest-workspace/<task_id>/experiment/skill_invocations.jsonl
.inftest-workspace/<task_id>/experiment/hooks.jsonl
.inftest-workspace/<task_id>/experiment/summary.md
```

Planner stub 请求日志：

```text
.inftest-workspace/planner-api-stub/
```

## 10. 当前能力状态

### 10.1 已真实运行

- 主 Agent HTTP 服务。
- `INFTEST_RUNNER=stateful` 状态机链路。
- Skill / Hook 实验轨迹。
- CLI 调用 `gui-tester/run_API.py`。
- CLI 调用 `inftest-report-agent/run_report.py`。
- `GET /tasks/{task_id}` 查询本地任务状态。

### 10.2 当前是 stub

- `POST /api/generate-plan`
- `POST /api/plan-task-publish`
- `POST /api/case-publish`
- `POST /api/task-report-generate`
- `POST /api/user-instruction`

`/api/task-manage` 已从 stub 升级为 real（异步），见 13.7。
- `POST /api/payload`

### 10.3 当前是静态本地能力

- 用例生成：静态用例，未接真实用例生成 Agent。
- 设备调度：静态绑定，未接真实设备调度 Agent。

### 10.4 当前不应该使用

```bash
INFTEST_EXECUTION_AGENT_MODE=mock
```

服务器无设备时只用：

```bash
INFTEST_MOCK_DEVICE=1
```

## 11. 对接口时的最短话术

可以这样和对方说：

```text
主 Agent 的 HTTP base URL 是 http://<server-host>:8787。

你们先打 GET /health 验证服务。
然后打 /api/generate-plan、/api/task-manage 等 /api/* 验证 Planner API 合同。
这些 /api/*（除 `/api/task-manage`）当前是 stub，只返回 code=0 并落日志，不会启动真实任务。

真实任务控制入口：

- 异步：`POST /api/task-manage`（`START/RESTART` 立即 ACK）
- 同步：`POST /tasks/alter`（`START` 等待执行完成）

同步启动示例：
{"task_id":"task-server-001","task_operation":"START"}

任务状态用 GET /tasks/task-server-001 查。
联调时我们看 runner 是否是 stateful，run_fake_e2e_invoked 是否是 false。

如果失败在模型 Connection error，是报告 Agent 的模型服务未连通，不是 HTTP 对接失败。
```

## 12. 现场排查顺序

1. 代理服务是否能访问：

```bash
curl http://<server-host>:8787/health
```

2. Planner stub 是否有日志：

```text
.inftest-workspace/planner-api-stub/
```

3. 是否真正启动了任务：

```bash
curl http://127.0.0.1:8787/tasks/<task_id>
```

4. 执行 Agent 是否成功：

```text
.inftest-workspace/<task_id>/execution/result.json
.inftest-workspace/<task_id>/execution/logs/real_execution_agent.stdout.log
.inftest-workspace/<task_id>/execution/results/case_result.json
.inftest-workspace/<task_id>/execution/results/summary.json
```

5. 报告 Agent 是否成功：

```text
.inftest-workspace/<task_id>/analysis/result.json
.inftest-workspace/<task_id>/analysis/logs/real_report_agent.stdout.log
.inftest-workspace/<task_id>/analysis/report.md
```

6. stateful 过程是否完整：

```text
.inftest-workspace/<task_id>/experiment/state_transitions.jsonl
.inftest-workspace/<task_id>/experiment/skill_invocations.jsonl
.inftest-workspace/<task_id>/experiment/hooks.jsonl
```

快速判断：

- `/api/*` 有日志但没有任务目录：正常，因为 `/api/*` 是 stub。
- 有 `case_result.json`、`summary.json`，但没有 `report.md`：报告 Agent 或模型服务问题。
- 没有 `case_result.json`：执行 Agent、`API_PORT`、设备或设备 mock 问题。
- `run_fake_e2e_invoked=true`：跑错模式，不是当前服务器联调口径。

## 13. 字段对齐清单

截图里说的“再对齐字段”主要对这几类字段：

1. 智能体代理服务调用主 Agent 的 HTTP 请求字段。
2. 主 Agent 返回给智能体代理服务的响应字段。
3. 主 Agent 本地任务状态字段。
4. 子 Agent 运行依赖字段，也就是环境变量和产物路径。

### 13.1 统一响应包

当前主 Agent 所有 HTTP JSON 响应都用统一包：

成功：

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

无 `data` 的成功：

```json
{
  "code": 0,
  "message": "Task paused"
}
```

失败：

```json
{
  "code": 400,
  "message": "Invalid request"
}
```

字段对齐时要确认：

| 字段 | 类型 | 当前含义 | 是否固定 |
|---|---|---|---|
| `code` | number | `0` 表示成功；非 0 表示失败 | 是 |
| `message` | string | 成功或错误信息 | 是 |
| `data` | object | 具体接口数据；部分成功响应没有 `data` | 否 |

### 13.2 通用请求字段

Planner `/api/*` stub 支持这两个通用请求 ID 来源：

| 字段 / Header | 类型 | 说明 |
|---|---|---|
| `request_id` | string | 推荐由调用方传，日志文件名会使用它 |
| `x-request-id` | header | 如果 body 没有 `request_id`，可用这个 header |

如果两个都没有，主 Agent 会自动生成 UUID。

日志位置：

```text
.inftest-workspace/planner-api-stub/<request_id>.json

### 13.2.1 2026-05-29 口径更新（覆盖旧 stub 描述）

`/api/*` 已全量 real 化，以下语义覆盖旧版文档中 “当前状态：stub” 的描述：

| 接口 | 当前状态 | 说明 |
|---|---|---|
| `/api/generate-plan` | real（异步受理） | 建立/更新计划上下文，返回 `plan_status` |
| `/api/plan-task-publish` | real（异步受理） | 下发任务列表，建立 `plan_id -> exec_id[]` 映射 |
| `/api/case-publish` | real（异步受理） | 绑定用例到 exec 上下文 |
| `/api/task-report-generate` | real（状态驱动） | 根据执行状态返回报告可用性，不再固定 stub 成功 |
| `/api/task-manage` | real（异步） | `START/RESTART` 异步，`PAUSE/CONTINUE/TERMINATION` 实时控制 |
| `/api/user-instruction` | real（异步受理） | 写入任务/计划指令上下文 |
| `/api/payload` | real（异步受理） | 兼容 payload 指令入口，按用户指令链路处理 |

统一约束：

- 成功返回仅表示“已受理/状态可用”，最终结果请查询 `GET /tasks/{exec_id}`。
- 返回主结构保持兼容：`code/message/data`。
- 请求幂等建议依赖 `request_id`。
```

### 13.3 `/api/generate-plan`

当前状态：stub。

请求必填字段：

| 字段 | 类型 | 当前校验 | 说明 |
|---|---|---|---|
| `plan_name` | string | 必填，非空 | 测试计划名称 |
| `project_id` | string | 必填，非空 | 项目 ID |
| `prd_file_key` | string | 必填，非空 | PRD 文件 key |
| `test_env_url` | string | 必填，非空 | 测试环境地址 |
| `test_strategies` | string[] | 必填，至少 1 个 | 测试策略 |
| `plan_config_info` | object | 必填 | 计划配置 |

建议一起对齐的可选字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `request_id` | string | 请求 ID |
| `plan_id` | string | 如代理服务已提前生成 plan_id，可以传 |
| `project_name` | string | 项目名称 |
| `remark` | string | 备注 |

当前响应 `data`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `request_id` | string | 请求 ID |
| `endpoint` | string | `/api/generate-plan` |
| `accepted` | boolean | 固定 `true` |
| `stub` | boolean | 固定 `true` |
| `plan_id` | string / null | 透传请求里的 `plan_id` |
| `plan_status` | string | 当前固定 `STUB_ACCEPTED` |

最小请求示例：

```json
{
  "request_id": "req-generate-plan-001",
  "plan_name": "登录流程测试计划",
  "project_id": "xh",
  "prd_file_key": "oss/prd.docx",
  "test_env_url": "https://test.example.com",
  "test_strategies": ["FUNCTIONAL"],
  "plan_config_info": {}
}
```

### 13.4 `/api/plan-task-publish`

当前状态：stub。

请求必填字段：

| 字段 | 类型 | 当前校验 | 说明 |
|---|---|---|---|
| `plan_id` | string | 必填，非空 | 计划 ID |

还必须至少包含下面任意一个字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `tasks` | array | 任务列表 |
| `task_list` | array | 任务列表，兼容命名 |
| `new_tasks` | array | 新增任务 |
| `deleted_task_ids` | array | 删除任务 ID |
| `plan_detail` | object | 计划详情 |

当前响应 `data`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `request_id` | string | 请求 ID |
| `endpoint` | string | `/api/plan-task-publish` |
| `accepted` | boolean | 固定 `true` |
| `stub` | boolean | 固定 `true` |
| `plan_id` | string | 透传请求里的 `plan_id` |
| `publish_status` | string | 当前固定 `STUB_ACCEPTED` |

最小请求示例：

```json
{
  "request_id": "req-plan-task-publish-001",
  "plan_id": "plan-001",
  "tasks": [
    {
      "task_id": "task-001",
      "task_name": "登录流程测试"
    }
  ]
}
```

### 13.5 `/api/case-publish`

当前状态：stub。

请求必填字段：

| 字段 | 类型 | 当前校验 | 说明 |
|---|---|---|---|
| `plan_id` | string | 必填，非空 | 计划 ID |

还必须至少包含下面任意一个数组字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `cases` | array | 用例列表 |
| `task_list` | array | 任务 / 用例列表，兼容命名 |
| `tasks` | array | 任务 / 用例列表，兼容命名 |

建议一起对齐的可选字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `task_id` | string | 任务 ID |
| `request_id` | string | 请求 ID |

当前响应 `data`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `request_id` | string | 请求 ID |
| `endpoint` | string | `/api/case-publish` |
| `accepted` | boolean | 固定 `true` |
| `stub` | boolean | 固定 `true` |
| `plan_id` | string | 透传请求里的 `plan_id` |
| `task_id` | string / null | 透传请求里的 `task_id` |
| `case_status` | string | 当前固定 `STUB_ACCEPTED` |

最小请求示例：

```json
{
  "request_id": "req-case-publish-001",
  "plan_id": "plan-001",
  "task_id": "task-001",
  "cases": [
    {
      "case_id": "case-001",
      "case_name": "登录成功"
    }
  ]
}
```

### 13.6 `/api/task-report-generate`

当前状态：stub。

请求必填字段：

| 字段 | 类型 | 当前校验 | 说明 |
|---|---|---|---|
| `task_id` | string | 必填，非空 | 任务 ID |

当前响应 `data`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `request_id` | string | 请求 ID |
| `endpoint` | string | `/api/task-report-generate` |
| `accepted` | boolean | 固定 `true` |
| `stub` | boolean | 固定 `true` |
| `task_id` | string | 透传请求里的 `task_id` |
| `task_status` | string | 当前固定 `PENDING` |
| `report_status` | string | 当前固定 `PENDING` |

最小请求示例：

```json
{
  "request_id": "req-report-generate-001",
  "task_id": "task-001"
}
```

### 13.7 `/api/task-manage`

当前状态：**real（异步）**，会触发真实任务控制。

请求必填字段：

| 字段 | 类型 | 当前校验 | 说明 |
|---|---|---|---|
| `exec_id` 或 `task_id` | string | 必填，非空 | 执行任务 ID |
| `task_operation` | enum | 必填 | `START` / `PAUSE` / `CONTINUE` / `TERMINATION` / `RESTART` |

操作语义：

| 操作 | 行为 | 返回时机 |
|---|---|---|
| `START` | 异步启动真实任务 | 立即 ACK，`task_status=PENDING` |
| `RESTART` | 先终止旧任务（若存在）再异步启动 | 立即 ACK |
| `PAUSE` | 真实暂停 | 同步返回 |
| `CONTINUE` | 真实继续 | 同步返回 |
| `TERMINATION` | 真实终止 | 同步返回 |

当前响应 `data`（`START/RESTART`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `request_id` | string | 请求 ID |
| `endpoint` | string | `/api/task-manage` |
| `accepted` | boolean | 是否受理 |
| `stub` | boolean | 固定 `false` |
| `async` | boolean | 固定 `true` |
| `exec_id` | string | 执行任务 ID |
| `task_id` | string | 兼容字段，同 `exec_id` |
| `task_operation` | string | 透传请求里的 `task_operation` |
| `task_status` | string | `START/RESTART` 受理时为 `PENDING` |

最小请求示例：

```json
{
  "request_id": "req-task-manage-001",
  "exec_id": "exec-001",
  "task_operation": "START"
}
```

注意：

```text
/api/task-manage START 只表示“已受理并开始异步执行”，不会等待任务跑完。
最终结果请通过 GET /tasks/{exec_id} 查询。
若需要同步等待执行完成，请使用 POST /tasks/alter START。
```

### 13.8 `/api/user-instruction` 和 `/api/payload`

当前状态：stub。

`/api/payload` 当前按 `/api/user-instruction` 兼容处理。

请求必填字段：

| 字段 | 类型 | 当前校验 | 说明 |
|---|---|---|---|
| `user_instruction` | string | 必填，非空 | 用户自然语言指令 |

还必须至少包含下面任意一个字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `plan_id` | string | 计划 ID |
| `task_id` | string | 任务 ID |

当前响应 `data`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `request_id` | string | 请求 ID |
| `endpoint` | string | 统一返回 `/api/user-instruction` |
| `accepted` | boolean | 固定 `true` |
| `stub` | boolean | 固定 `true` |
| `plan_id` | string / null | 透传请求里的 `plan_id` |
| `task_id` | string / null | 透传请求里的 `task_id` |
| `message_id` | string | 等于 `request_id` |
| `finished` | boolean | 固定 `true` |
| `content` | string | 固定提示文案 |

最小请求示例：

```json
{
  "request_id": "req-user-instruction-001",
  "task_id": "task-001",
  "user_instruction": "继续执行"
}
```

### 13.9 `/tasks/alter`

当前状态：真实任务控制接口。

请求字段严格校验，只接受下面字段：

| 字段 | 类型 | 当前校验 | 说明 |
|---|---|---|---|
| `task_id` | string | 必填，非空 | 任务 ID |
| `task_operation` | enum | 必填 | 只支持 `START` / `PAUSE` / `CONTINUE` |

`START` 请求示例：

```json
{
  "task_id": "task-server-001",
  "task_operation": "START"
}
```

`START` 成功响应 `data` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `task_id` | string | 任务 ID |
| `task_status` | string | `SUCCESS` / `FAILED` 等 |
| `current_stage` | string / null | 当前阶段 |
| `workspace` | string | 本地任务目录 |
| `runner` | string | 当前应为 `stateful` |
| `artifacts` | object | 产物路径映射 |
| `run_fake_e2e_invoked` | boolean | 服务器联调应为 `false` |
| `orchestration` | string | 当前 stateful 返回 `stateful` |
| `steps` | array | 执行步骤摘要 |

注意：

- `/tasks/alter` 不接受 `TERMINATION`，终止请用 `/tasks/terminate`。
- `/tasks/alter` 是当前真正推动 stateful runner 的接口。
- 如果 `INFTEST_RUNNER` 配错，`runner` 会不是 `stateful`。

### 13.10 `/tasks/terminate`

当前状态：真实任务控制接口。

请求字段：

| 字段 | 类型 | 当前校验 | 说明 |
|---|---|---|---|
| `task_id` | string | 必填，非空 | 任务 ID |
| `project_id` | string | 可选 | 当前不作为核心控制字段 |

请求示例：

```json
{
  "task_id": "task-server-001"
}
```

成功响应：

```json
{
  "code": 0,
  "message": "Task terminated"
}
```

### 13.11 `GET /tasks/{task_id}`

当前状态：真实任务查询接口。

响应 `data.task_detail` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `task_id` | string | 任务 ID |
| `task_status` | string | `PENDING` / `RUNNING` / `PAUSED` / `SUCCESS` / `FAILED` / `TERMINATED` |
| `current_stage` | string / null | `PLANNING` / `DATA_GEN` / `COORDINATE` / `EXECUTING` / `REFLECTING` / `COMPLETED` |
| `previous_stage` | string / null | 上一阶段 |
| `active_skill` | string / null | 当前运行中的 skill |
| `blocking_reason` | string / null | 阻塞原因 |
| `stage_history` | array | 状态流转记录 |
| `workspace` | string | 本地任务目录 |
| `runner` | string | `fake` / `query` / `available` / `stateful` |
| `started_at` | string | ISO 时间 |
| `finished_at` | string / null | ISO 时间 |
| `last_error` | string / null | 最近错误 |
| `run_fake_e2e_invoked` | boolean | 是否走了 fake E2E |
| `artifacts` | object | 产物路径映射 |
| `message` | string | 面向调用方的任务摘要 |

现场对齐时重点看：

```text
runner = stateful
run_fake_e2e_invoked = false
task_status
current_stage
last_error
artifacts
```

### 13.12 子 Agent 环境变量字段

这些不是 HTTP 字段，但必须和执行 / 报告 Agent 负责人对齐。

| 环境变量 | 必填 | 说明 |
|---|---:|---|
| `INFTEST_HOST` | 是 | 主 Agent 监听地址，服务器用 `0.0.0.0` |
| `INFTEST_PORT` | 是 | 主 Agent 端口，推荐 `8787` |
| `INFTEST_RUNNER` | 是 | 当前推荐 `stateful` |
| `INFTEST_CONFIG` | 是 | `.inftest/config.available-agents.example.json` |
| `API_PORT` | 是 | `gui-tester/front/api_server.py` 端口 |
| `INFTEST_EXECUTION_AGENT_CWD` | 是 | `gui-tester` 目录 |
| `INFTEST_EXECUTION_AGENT_PYTHON` | 是 | 能跑 `gui-tester` 的 Python |
| `INFTEST_REPORT_AGENT_CWD` | 是 | `inftest-report-agent` 目录 |
| `INFTEST_REPORT_AGENT_PYTHON` | 是 | 能跑报告 Agent 的 Python |
| `INFTEST_REQUIREMENT_DOC` | 是 | 需求文档路径 |
| `INFTEST_MOCK_DEVICE` | 只给 gui-tester | 无真实设备时可设为 `1` |

不要设置：

```bash
INFTEST_EXECUTION_AGENT_MODE=mock
```

### 13.13 需要现场确认的问题

和智能体代理服务负责人确认：

- 他们最终调用的是 `/api/task-manage` 还是 `/tasks/alter`？
- 如果他们只认 `/api/task-manage START`，是否接受当前先作为 stub，对真实启动另走 `/tasks/alter START`？
- `request_id` 由谁生成？是否需要每次必传？
- `task_operation` 的枚举是否使用 `TERMINATION` 还是 `TERMINATE`？
- `plan_id`、`task_id`、`case_id` 是谁生成，生命周期如何对应？
- `prd_file_key` 是文件 key，还是需要主 Agent 能直接下载文件？
- 响应包是否统一接受 `{ code, message, data }`？
- 失败时他们希望 HTTP status 跟随错误码，还是永远 HTTP 200、只看 body `code`？

和执行 Agent 负责人确认：

- `front/api_server.py` 部署在哪台机器，端口是多少？
- 主 Agent 机器能否访问 `http://127.0.0.1:<API_PORT>`？如果不在同机，需要怎么改访问地址？
- 服务器是否有真实设备？没有的话是否允许 `INFTEST_MOCK_DEVICE=1`？
- `run_API.py --case --json` 是否仍是当前入口？

和报告 Agent / 模型服务负责人确认：

- `run_report.py` 的 Python 环境路径。
- `requirements.docx` 的服务器路径。
- `inftest-report-agent/.env` 中 `BASE_URL`、`MODEL`、`API_KEY`。
- 模型服务是否支持 OpenAI `/v1/chat/completions`。
- 如果报告失败，是否能接受先以 `analysis/result.json` 和 stdout 日志定位。
