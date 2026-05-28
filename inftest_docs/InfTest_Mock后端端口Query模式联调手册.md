# InfTest Mock 后端端口 Query 模式联调手册

> 日期：2026-05-27  
> 目标：模拟“用户从平台端口发起任务”，验证 `HTTP 后端入口 -> InfTest 主 Agent API -> QueryEngine 主 Agent -> 工具链 -> mock 子 Agent -> 状态回传`。

## 1. 结论

带 mock 端口、要尽量模拟真实用户输入时，应该使用：

```bash
INFTEST_RUNNER=query
INFTEST_ORCHESTRATION=stepwise
```

原因：

- `query` 模式会进入 InfTest 主 Agent 的模型编排链路，由模型按工具一步步执行。
- `stepwise` 模式会强制走 `get_task_detail -> init_workspace -> write_plan_dag -> invoke_subagent -> watch_execution_results -> report_task_update` 这类真实工具序列。
- `available` 模式是确定性 runner，适合验证真实 CLI adapter 接线，但不验证“用户输入后主 Agent 自己思考并调工具”的过程。

因此：

```text
验证真实 CLI adapter 接线：available
验证端口级用户输入 + 主 Agent 编排：query + stepwise
```

## 2. 当前端口拓扑

```text
用户/平台请求
POST /api/tasks/alter
  -> mock 后端端口
  -> 转发 START 到 InfTest 主 Agent API
  -> InfTestQueryRunner
  -> QueryEngine + InfTest tools
  -> mock 子 Agent
  -> 产物写入 .inftest-workspace/<task_id>
  -> report_task_update 回传 mock 后端 /api/tasks/update
  -> 返回 SUCCESS
```

本轮新增脚本：

```text
scripts/inftest_mock_backend_api.ts
scripts/inftest_mock_backend_query_e2e.ts
```

常用端口：

```text
InfTest 主 Agent API：127.0.0.1:8787
mock 后端 API：127.0.0.1:8790
```

E2E 为避免端口占用，可指定临时端口：

```text
InfTest 主 Agent API：127.0.0.1:18887
mock 后端 API：127.0.0.1:18890
```

## 3. 一条命令复现

在 `InfTest-Main-Agent` 目录执行：

```bash
bun run scripts/inftest_mock_backend_query_e2e.ts \
  --task-id task-port-query-003 \
  --agent-port 18887 \
  --backend-port 18890
```

或使用 package script：

```bash
bun run inftest:mock-backend-query-e2e --task-id task-port-query-003 --agent-port 18887 --backend-port 18890
```

该脚本会自动：

- 启动 InfTest 主 Agent API。
- 启动 mock 后端 API。
- 向 mock 后端发起 `POST /api/tasks/alter START`。
- mock 后端再转发到主 Agent `/tasks/alter`。
- 等待主 Agent 完成 query/stepwise 工具链。
- 读取 mock 后端记录的 update 事件和主 Agent 返回。

## 4. 手动双端口复现

终端 1：启动主 Agent API。

```bash
INFTEST_RUNNER=query \
INFTEST_ORCHESTRATION=stepwise \
INFTEST_PROXY_BASE_URL=http://127.0.0.1:8790 \
INFTEST_PROXY_TASK_REPORT_PATH=api/tasks/update \
bun run scripts/inftest_task_api.ts
```

终端 2：启动 mock 后端。

```bash
INFTEST_AGENT_BASE_URL=http://127.0.0.1:8787 \
INFTEST_MOCK_BACKEND_PORT=8790 \
bun run scripts/inftest_mock_backend_api.ts
```

终端 3：模拟平台用户启动任务。

```bash
curl -sS -X POST http://127.0.0.1:8790/api/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "task-port-query-manual-001",
    "task_operation": "START",
    "task_target": "用户通过 mock 后端端口启动任务：请按 InfTest 主 Agent 工具链生成计划、调用子 Agent、上报状态并产出报告。"
  }'
```

查看 mock 后端记录：

```bash
curl -sS http://127.0.0.1:8790/api/mock/tasks/task-port-query-manual-001
```

## 5. 已验证结果

本机已验证任务：

```text
task-port-query-003
```

结果：

```json
{
  "ok": true,
  "mode": "mock-backend + query + stepwise",
  "task_status": "SUCCESS",
  "runner": "query",
  "orchestration": "stepwise",
  "run_fake_e2e_invoked": false,
  "update_count": 10
}
```

主 Agent 实际执行的工具链包括：

```text
get_task_detail
init_workspace
write_plan_dag
invoke_subagent:test_generation
write_artifact:reflection_report.md
invoke_subagent:device_scheduler
invoke_subagent:test_executor
watch_execution_results
invoke_subagent:result_analyzer
report_task_update:SUCCESS
```

## 6. 成功产物

任务产物目录：

```text
.inftest-workspace/task-port-query-003
```

关键产物：

```text
.inftest-workspace/task-port-query-003/plan.json
.inftest-workspace/task-port-query-003/case_generation/test_cases.json
.inftest-workspace/task-port-query-003/device_scheduling/device_bindings.json
.inftest-workspace/task-port-query-003/execution/results/summary.json
.inftest-workspace/task-port-query-003/analysis/report.json
.inftest-workspace/task-port-query-003/analysis/report.md
```

API 返回已能带出标准产物路径：

```json
{
  "artifacts": {
    "plan": ".inftest-workspace/<task_id>/plan.json",
    "test_cases": ".inftest-workspace/<task_id>/case_generation/test_cases.json",
    "device_bindings": ".inftest-workspace/<task_id>/device_scheduling/device_bindings.json",
    "execution_summary": ".inftest-workspace/<task_id>/execution/results/summary.json",
    "analysis_report_json": ".inftest-workspace/<task_id>/analysis/report.json",
    "analysis_report": ".inftest-workspace/<task_id>/analysis/report.md"
  }
}
```

## 7. 注意事项

- 这条链路不是 `available`，也不是 `run_fake_e2e` 聚合工具。
- 这条链路仍然使用当前仓库里的 mock 子 Agent，不调用真实 `gui-tester` 和真实 `inftest-report-agent`。
- 它的价值是验证端口、任务 detail 拉取、状态上报、主 Agent 模型编排和工具调用闭环。
- 要验证真实 CLI 子 Agent，继续用 `INFTEST_RUNNER=available`。
- 要模拟平台端口用户输入，优先用本文的 `query + stepwise + mock backend`。

## 8. 常见失败点

### 8.1 无模型凭据

现象：脚本提示缺少 InfTest model credentials，或 query runner 不能启动。

处理：先配置主 Agent 可用的 CCB/模型凭据，再跑端口 E2E。

### 8.2 端口占用

现象：启动失败或 EADDRINUSE。

处理：换端口：

```bash
bun run scripts/inftest_mock_backend_query_e2e.ts \
  --task-id task-port-query-004 \
  --agent-port 18987 \
  --backend-port 18990
```

### 8.3 产物路径为空

历史原因：stepwise query 只写文件，不一定通过单个工具返回完整 artifacts。

当前处理：`TaskSessionManager.finishSessionFromQueryResult` 已在任务结束时从 workspace 自动识别标准产物。
