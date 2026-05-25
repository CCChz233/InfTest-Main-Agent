# CCB InfTest Demo 操作手册

> 更新日期：2026-05-25  
> 快速索引见根目录 [README](../README.md#inftest-mvp-使用方式)

> 服务器真实 Agent 联调请优先看：[InfTest 服务器部署联调手册](./InfTest_服务器部署联调手册.md)


## 0. 文件配置（模型 API）

```bash
cp .inftest/config.example.json .inftest/config.json
```

编辑 `model.api_key`（或 `model.auth_token` + `model.base_url`）。`runner: query` 时执行 `make query-e2e` / `make server` 即可，无需每次 `export`。

## 1. 环境准备

在仓库根目录执行所有命令：

```bash
cd /path/to/claude-code-cli
bun install
```

日常操作优先使用根目录 `Makefile`（固定 Bun 路径并设置 PATH）：

```bash
make typecheck   # 可选
```

## 2. Fake 模式：命令行 E2E

最稳定的验收方式，**不依赖大模型、不依赖真实子 Agent**。

```bash
make fake-e2e
```

预期：

- 终端 JSON 中 `status` 为 `SUCCESS`
- workspace：`.inftest-workspace/task-demo-001/`

关键产物：

| 文件 | 路径 |
|------|------|
| plan.json | `.inftest-workspace/task-demo-001/plan.json` |
| test_cases.json | `.inftest-workspace/task-demo-001/case_generation/test_cases.json` |
| device_bindings.json | `.inftest-workspace/task-demo-001/device_scheduling/device_bindings.json` |
| summary.json | `.inftest-workspace/task-demo-001/execution/results/summary.json` |
| report.md | `.inftest-workspace/task-demo-001/analysis/report.md` |

指定任务 ID（若 `make` 不转发参数，可直接用 bun）：

```bash
bun run scripts/inftest_fake_e2e.ts --task-id task-demo-001
```

API 级自动验收：

```bash
make api-e2e-fake
```

## 3. 当前可用 Agent 联调：跳过用例生成

当用例生成 Agent 不可用、但用例执行 Agent 和报告生成 Agent 可用时，使用当前可用 Agent 联调入口：

```bash
make available-agents-e2e
```

默认会在本地使用 fake 执行/报告 Agent 验证编排链路，并生成：

```text
.inftest-workspace/task-available-001/plan.json
.inftest-workspace/task-available-001/device_scheduling/device_case_bind.json
.inftest-workspace/task-available-001/execution/results/case_result.json
.inftest-workspace/task-available-001/analysis/report.md
```

真实业务 Agent 是 **CLI 子进程调用**，不是 HTTP 调用。接真实执行/报告 Agent 时，使用 `.inftest/config.available-agents.example.json` 作为本次命令配置，并设置真实 Agent 路径：

```bash
export INFTEST_EXECUTION_AGENT_CWD=/root/inftest_execute_agent
export INFTEST_REPORT_AGENT_CWD=/path/to/report_agent
export INFTEST_REQUIREMENT_DOC=/path/to/requirements.docx
INFTEST_CONFIG=.inftest/config.available-agents.example.json make available-agents-e2e
```

服务器上优先跑 CLI 链路，确认成功后再考虑 HTTP 平台入口。

详细计划见 [InfTest 当前可用 Agent 联调测试计划](./InfTest_当前可用Agent联调测试计划.md)。

## 4. Fake 模式：HTTP Server

```bash
make server
```

默认 `http://127.0.0.1:8787`。端口占用时：

```bash
INFTEST_PORT=39001 make server
```

### 健康检查

```bash
curl -sS http://127.0.0.1:8787/health
```

### 启动任务

```bash
curl -sS -X POST http://127.0.0.1:8787/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-demo-001","task_operation":"START"}'
```

预期响应字段（统一结构）：

- `task_id`、`runner`（`fake`）、`status`（`SUCCESS`）
- `workspace`、`artifacts`（各产物绝对路径）、`message`

### 查询与控制

```bash
# 查询
curl -sS http://127.0.0.1:8787/tasks/task-demo-001

# 控制（需先 START 成功）
curl -sS -X POST http://127.0.0.1:8787/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-demo-001","task_operation":"PAUSE"}'

curl -sS -X POST http://127.0.0.1:8787/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-demo-001","task_operation":"CONTINUE"}'

curl -sS -X POST http://127.0.0.1:8787/tasks/terminate \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-demo-001"}'
```

`PAUSE` / `CONTINUE`：更新 session 状态并返回当前 session。  
`TERMINATE`：状态设为 `TERMINATED`，并尝试终止进程内登记中的 fake 子 Agent 子进程。

## 5. Query 模式

通过 CCB headless `QueryEngine` 驱动：模型调用 `run_fake_e2e` tool，内部仍走 deterministic fake 流程。

### 命令行

```bash
make query-e2e
```

需 `ANTHROPIC_API_KEY` 或 REPL `/login` 配置；无凭证时 exit 2。

### HTTP

```bash
INFTEST_RUNNER=query make server
```

```bash
curl -sS -X POST http://127.0.0.1:8787/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-demo-001","task_operation":"START"}'
```

预期：

- `runner` 为 `query`，`status` 为 `SUCCESS`
- `GET /tasks/task-demo-001` 中 `run_fake_e2e_invoked` 为 `true`

```bash
make api-e2e-query
```

## 6. /tasks/chat/stream（SSE MVP）

基于已有 task session 上下文，调用 QueryEngine 流式回答用户问题（**不修改任务流程**）。

```bash
curl -N -X POST http://127.0.0.1:8787/tasks/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"user_id":"user-demo","task_id":"task-demo-001","user_instruction":"总结一下当前任务状态"}'
```

SSE 每条 `data:` 形如：

```json
{"task_id":"task-demo-001","chunk":"...","finished":false,"message_id":"..."}
```

结束时 `finished: true`。需模型凭证；`task_id` 不存在返回 404。

> 说明：此为 MVP，非完整生产级流式会话（无流中断恢复、无与长任务执行深度联动）。

## 7. 演示流程（领导验收）

| 顺序 | 动作 | 时长 | 说明 |
|------|------|------|------|
| 1 | `make fake-e2e` | ~1 min | 零模型，展示 SUCCESS + 打开 plan.json / report.md |
| 2 | `make server` + `POST /tasks/alter START` | ~2 min | 证明 HTTP 平台接入，`artifacts` 与磁盘一致 |
| 3 | `GET /tasks/...` + PAUSE/CONTINUE/TERMINATE | ~2 min | 证明任务状态可查、可控制（MVP） |
| 4 |（可选）`INFTEST_RUNNER=query make server` + START | ~3 min | 证明 CCB Agent + tool 调用 |
| 5 |（可选）`POST /tasks/chat/stream` | ~2 min | 证明流式问答 |

**推荐话术**：CCB 已作为 InfTest 主 Agent 运行时；fake 模式完整跑通测试闭环，query 模式验证大模型经 tool 驱动同一流程。

## 8. 当前未实现

- 真实用例生成 Agent、真实设备调度 Agent
- 真实执行 Agent / 报告 Agent 已有适配脚本，但尚未在服务器完成联调验收
- `/tasks/chat/stream` 完整生产能力（会话恢复、与执行中任务联动等）
- 真实设备控制与平台设备池
- 深度 PAUSE/CONTINUE（模型流中断、真实执行 Agent 暂停恢复）

## 9. 常用命令

```bash
make typecheck
make fake-e2e
make available-agents-e2e
make query-e2e
make api-e2e-fake
make api-e2e-query
make server
bun test src/inftest/__tests__/
```

设计文档：`inftest_docs/CCB_InfTest主Agent改造计划.md`、`inftest_docs/CCB_InfTest_开发进度.md`


## 编排模式

- 默认 `aggregate`：`make query-e2e`
- 实验 `stepwise`：`make query-e2e-stepwise`（需模型凭证；会强制 `INFTEST_ORCHESTRATION=stepwise`）
