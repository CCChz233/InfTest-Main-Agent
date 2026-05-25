# CCB InfTest 改造开发任务清单

## M0：原项目跑通

目标：确认 CCB 本身可运行。

任务：

```bash
bun install
bun run dev
bun run build
```

验收：

- REPL 可启动；
- `/login` 可配置模型；
- 能正常对话。

---

## M1：Headless QueryEngine 验证

目标：确认平台可以绕过 REPL 调用 CCB。

新增文件：

```text
scripts/inftest_headless_test.ts
```

任务：

- 创建 QueryEngine；
- 调用 `submitMessage("请回复 ok")`；
- 打印模型输出。

验收：

- 不进入 REPL，也能拿到模型响应。

---

## M2：注册第一个 InfTest Tool

目标：确认 CCB 可调用自定义工具。

新增工具：

```text
get_task_detail
```

返回：

```json
{
  "task_id": "task-demo-001",
  "task_target": "测试登录功能",
  "task_config": {
    "enable_case_generation": true,
    "enable_device_manager": true,
    "enable_test_execution": true,
    "enable_result_analysis": true
  }
}
```

验收：

- 模型能主动调用 `get_task_detail`；
- 工具结果能回到 agent loop。

---

## M3：Workspace + PlanDAG

新增工具：

- `init_workspace`
- `write_plan_dag`

目标目录：

```text
/workspace/{task_id}/
├── input/
├── case_generation/
├── data_mock/
├── device_scheduling/
├── execution/results/
├── execution/logs/
├── analysis/
└── plan.json
```

验收：

- 能生成 workspace；
- 能写入 `plan.json`。

---

## M4：invoke_subagent + fake case generation

新增：

```text
mock_agents/fake_case_generation_agent.py
src/inftest/tools/invokeSubagent.ts
```

统一调用协议：

```bash
python mock_agents/fake_case_generation_agent.py \
  --task-id task-demo-001 \
  --workspace /workspace/task-demo-001 \
  --output-json /workspace/task-demo-001/case_generation/result.json
```

验收：

- 生成 `test_cases.json`；
- 生成 `result.json`；
- CCB 能通过 `invoke_subagent` 调用它。

---

## M5：完整 fake 测试闭环

新增：

- `fake_device_scheduler.py`
- `fake_execution_agent.py`
- `fake_result_analysis_agent.py`
- `watch_execution_results`
- `report_task_update`

验收：

- 能生成设备绑定；
- 执行 Agent 能逐个写 `case_*.json`；
- 监听器能逐用例上报；
- 能生成 `report.md`；
- 最终上报 `SUCCESS`。

---

## M6：新增 InfTest HTTP API

新增：

```text
src/inftest/server/taskApi.ts
```

接口：

```text
GET /health
POST /task
POST /chat/stream
```

验收：

```bash
curl -X POST http://localhost:xxxx/task \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-demo-001","task_operation":"START"}'
```

能够启动 InfTest 任务。

---

## M7：任务控制

实现：

- `PAUSE`
- `CONTINUE`
- `TERMINATE`

验收：

- 执行阶段可以暂停；
- 可以继续；
- 终止时能 kill 子进程；
- 状态能上报 `TERMINATED`。

---

## M8：替换真实子 Agent

替换顺序：

1. 真实测试生成 Agent；
2. 真实设备调度 Agent；
3. 真实结果分析 Agent；
4. 真实测试执行 Agent。

原则：

- 只改 `AGENT_COMMANDS` 或 adapter 配置；
- 不改主流程；
- 执行 Agent 最后接。
