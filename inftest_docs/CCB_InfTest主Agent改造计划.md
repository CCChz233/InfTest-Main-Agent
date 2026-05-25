# CCB 改造成 InfTest Planner/Reflection 主 Agent 的实施方案 v2

> 版本：v2.0  
> 适用对象：基于 Claude Code Best V5（CCB）源码改造 InfTest 主 Agent  
> 当前状态：HTTP `/tasks/*`、SessionManager、chat/stream MVP、`.inftest/config.json`、`INFTEST_ORCHESTRATION`（aggregate/stepwise）与 CLI 子 Agent 协议已对齐；文档持续收口。  
> 核心结论：**主 Agent 使用 CCB QueryEngine；业务子 Agent 通过 CLI 调用；CCB 内部 subagent 暂不作为业务子 Agent 主链路。**

---

## 1. 当前架构结论

本项目的主链路不是“把业务子 Agent 改造成 CCB forkedAgent / swarm worker”，而是：

```text
HTTP /task START
        ↓
InfTestRunner / InfTestQueryRunner
        ↓
CCB QueryEngine.submitMessage
        ↓
queryLoop
        ↓
InfTest Tools
        ↓
SubAgentAdapter
        ↓
CLI 子 Agent
        ↓
workspace 产物 + output-json
        ↓
任务状态 / 最终结果
```

因此，业务边界应明确为：

- **CCB**：负责模型调用、agent loop、tool calling、会话上下文。
- **InfTestRunner**：负责任务生命周期、runner 模式选择、task_id/session_id 映射、最终结果收口。
- **InfTest Tools**：负责业务动作，例如运行 fake E2E、读取任务、创建 workspace、上报状态、读写产物。
- **SubAgentAdapter**：负责受控启动 CLI 子 Agent，并解析其 `--output-json` 结果。
- **CLI 子 Agent**：负责具体业务阶段，例如用例生成、设备调度、测试执行、结果分析。
- **workspace**：负责所有阶段的大输入/大输出交换。

一句话：

> **CCB 主 Agent 通过工具调用 CLI 子 Agent，完成测试任务编排。**

---

## 2. 已定位到的 CCB 核心代码

| 代码位置 | 作用 | 当前使用策略 |
|---|---|---|
| `src/query.ts` 的 `queryLoop` | 真正的 agent/tool 循环 | 不改主逻辑 |
| `src/QueryEngine.ts` 的 `QueryEngine.submitMessage` | 会话编排入口，调用 query | 作为 headless 主 Agent 接入点 |
| `src/screens/REPL.tsx` | TUI 交互层 | 不作为平台主入口 |
| `src/utils/forkedAgent.ts` | CCB forked 子代理 | 暂不用于业务子 Agent |
| `src/utils/swarm/spawnInProcess.ts` | in-process worker | 暂不用于 MVP |
| `src/coordinator/coordinatorMode.ts` | coordinator prompt / 策略 | 可参考 prompt 写法，不作为主链路 |

原则：

```text
平台不要驱动 REPL。
平台应该驱动 QueryEngine.submitMessage。
业务子 Agent 不进入 CCB subagent 体系，而是通过 CLI 调用。
```

---

## 3. 当前已完成能力

### 3.1 deterministic fake 模式

已完成：

```text
make fake-e2e
```

对应链路：

```text
FakeE2ERunner
→ get_task_detail
→ init_workspace
→ write_plan_dag
→ invoke_subagent(fake_case_generation)
→ invoke_subagent(fake_device_scheduler)
→ invoke_subagent(fake_execution)
→ watch_execution_results
→ invoke_subagent(fake_result_analysis)
→ SUCCESS
```

已生成产物：

```text
.inftest-workspace/{task_id}/
├── plan.json
├── case_generation/test_cases.json
├── device_scheduling/device_bindings.json
├── execution/results/summary.json
└── analysis/report.md
```

### 3.2 query 模式

已完成：

```text
make query-e2e
INFTEST_RUNNER=query + POST /task START
```

对应链路：

```text
InfTestQueryRunner
→ bootstrapInfTestHeadless()
→ QueryEngine.submitMessage
→ 模型调用 run_fake_e2e tool
→ FakeE2ERunner
→ SUCCESS
```

关键修复：

- 新增 `headlessBootstrap.ts`
- 对齐 print 模式初始化：
  - `enableConfigs()`
  - `applyConfigEnvironmentVariables()`
- 补齐 `MACRO.*` fallback，避免 `MACRO is not defined`
- `InfTestQueryRunner` 启动前执行 bootstrap
- 只暴露 `run_fake_e2e` 工具，降低 MVP 风险
- 强化 tool result 解析：
  - `tool_use_result`
  - `{ data }`
  - content block JSON
- 增加 `run_fake_e2e_invoked` 跟踪
- `maxTurns` 提高到 8

### 3.3 HTTP API

已完成：

| 接口 | 状态 |
|---|---|
| `GET /health` | 可用 |
| `POST /tasks/alter` START | fake/query 两种模式可用 |
| `POST /tasks/chat/stream` | SSE MVP 已实现（含可选 tool 事件）；深度 tool 追踪可持续增强 |

runner 模式：

```text
INFTEST_RUNNER=fake   # 默认 deterministic fake runner，不耗模型
INFTEST_RUNNER=query  # QueryEngine + 模型调用 run_fake_e2e tool
```

---

## 4. 当前 MVP 功能范围

MVP 的目标不是完整智能测试平台，而是证明：

> **CCB 可以作为 InfTest 主 Agent Runtime，通过 HTTP 接口启动任务，并通过 tool 调用 CLI 子 Agent 完成一条 fake 测试闭环。**

MVP 必须包含：

| 功能 | 状态 |
|---|---|
| Makefile 标准命令 | 已完成 |
| deterministic fake E2E | 已完成 |
| query E2E | 已完成 |
| HTTP `/task START` | 已完成 |
| workspace 产物生成 | 已完成 |
| `run_fake_e2e` tool | 已完成 |
| headless QueryEngine bootstrap | 已完成 |
| 统一结果结构 | 待完善 |
| TaskSessionManager | 已实现（内存 Map + 子进程终止 + query AbortScope） |
| `GET /tasks/{task_id}` | 已实现（`{code,message,data.task_detail}`） |
| `/chat/stream` | 待实现 |
| PAUSE/CONTINUE/TERMINATE 深度控制 | 待实现 |
| 真实子 Agent 替换 | 待实现 |

---

## 5. CLI 子 Agent 设计原则

mock agent 和未来真实 agent 都应被设计成 **CLI 程序**，而不是 CCB 内部 subagent。

### 5.1 统一 CLI 协议

所有子 Agent 必须支持：

```bash
python mock_agents/fake_xxx_agent.py \
  --task-id task-demo-001 \
  --workspace .inftest-workspace/task-demo-001 \
  --output-json .inftest-workspace/task-demo-001/xxx/result.json
```

建议额外支持：

```bash
--mode success|fail|partial|timeout
--delay-ms 1000
--input-json path/to/input.json
```

### 5.2 统一 output-json

成功：

```json
{
  "success": true,
  "agent_name": "test_generation",
  "status": "SUCCESS",
  "task_id": "task-demo-001",
  "artifacts": {
    "test_cases": ".inftest-workspace/task-demo-001/case_generation/test_cases.json"
  },
  "metrics": {
    "duration_ms": 1200,
    "total_tokens": 0
  },
  "error": null
}
```

失败：

```json
{
  "success": false,
  "agent_name": "test_generation",
  "status": "FAILED",
  "task_id": "task-demo-001",
  "artifacts": {},
  "metrics": {
    "duration_ms": 300
  },
  "error": {
    "code": "CASE_GENERATION_FAILED",
    "message": "mock failure"
  }
}
```

要求：

- 主结果必须写入 `--output-json`
- stdout/stderr 只作为日志
- 主 Agent 不从 stdout 解析主结果
- 失败必须结构化返回
- CLI 退出码必须稳定

### 5.3 退出码约定

| exit code | 含义 |
|---:|---|
| `0` | 成功 |
| `1` | 业务失败 |
| `2` | 系统异常 |
| `124` | timeout，由 SubAgentAdapter 标记 |

---

## 6. mock agent 设计

mock agent 的目标不是模拟智能，而是模拟真实子 Agent 的：

```text
CLI 参数
output-json
workspace 产物
退出码
耗时行为
失败模式
```

### 6.1 fake_case_generation_agent.py

职责：模拟测试生成 Agent。

输入：

```text
input/prd.md
task_config.json
```

产物：

```text
case_generation/test_cases.json
case_generation/result.json
```

`test_cases.json` 至少包含：

```json
{
  "root": {
    "node_id": "root",
    "title": "登录模块测试",
    "children": [
      {
        "node_id": "login_normal",
        "title": "账号密码正常登录",
        "type": "CASE",
        "preconditions": ["用户已注册"],
        "test_steps": ["打开登录页", "输入正确账号", "输入正确密码", "点击登录"],
        "expected_result": "登录成功，进入首页"
      },
      {
        "node_id": "login_wrong_password",
        "title": "错误密码登录",
        "type": "CASE",
        "preconditions": ["用户已注册"],
        "test_steps": ["打开登录页", "输入正确账号", "输入错误密码", "点击登录"],
        "expected_result": "提示账号或密码错误"
      }
    ]
  }
}
```

### 6.2 fake_device_scheduler.py

职责：模拟设备调度 Agent。

输入：

```text
case_generation/test_cases.json
```

产物：

```text
device_scheduling/device_bindings.json
device_scheduling/result.json
```

示例：

```json
{
  "bindings": [
    {
      "case_id": "login_normal",
      "device_id": "mock-android-001",
      "platform": "android",
      "device_name": "Mock Pixel 7",
      "status": "BOUND"
    }
  ]
}
```

### 6.3 fake_execution_agent.py

职责：模拟长时间执行 Agent。

输入：

```text
device_scheduling/device_bindings.json
case_generation/test_cases.json
```

行为：

```text
逐条写 case_*.json
最后写 summary.json
```

产物：

```text
execution/results/case_login_normal.json
execution/results/case_login_wrong_password.json
execution/results/summary.json
execution/logs/*.log
execution/result.json
```

单 case 示例：

```json
{
  "case_id": "login_normal",
  "status": "SUCCESS",
  "duration_ms": 1500,
  "device_id": "mock-android-001",
  "failure_reason": null,
  "artifacts": {
    "log_file": ".inftest-workspace/task-demo-001/execution/logs/login_normal.log"
  }
}
```

summary 示例：

```json
{
  "task_id": "task-demo-001",
  "total": 2,
  "passed": 2,
  "failed": 0,
  "skipped": 0,
  "status": "SUCCESS",
  "case_results": [
    "case_login_normal.json",
    "case_login_wrong_password.json"
  ]
}
```

### 6.4 fake_result_analysis_agent.py

职责：模拟结果分析 Agent。

输入：

```text
execution/results/summary.json
execution/results/case_*.json
```

产物：

```text
analysis/report.md
analysis/report.json
analysis/result.json
```

report.md 示例：

```markdown
# InfTest Fake 测试报告

## 总览

- 总用例数：2
- 通过：2
- 失败：0

## 结论

当前 fake 测试闭环通过。
```

---

## 7. InfTest Tools 当前策略

MVP 阶段采用两层 tool 设计。

### 7.1 聚合工具：run_fake_e2e

当前 query 模式只暴露：

```text
run_fake_e2e
```

它内部复用 FakeE2ERunner，串起全部 CLI 子 Agent。

优点：

- 降低模型不确定性
- 减少 tool 调用步数
- 避免 prompt 不稳定
- 更适合 MVP 演示

### 7.2 细粒度工具：后续再开放

后续可逐步开放：

| Tool | 用途 |
|---|---|
| `get_task_detail` | 读取任务详情 |
| `init_workspace` | 创建 workspace |
| `write_plan_dag` | 写计划 |
| `invoke_subagent` | 调用单个 CLI 子 Agent |
| `watch_execution_results` | 监听执行结果 |
| `report_task_update` | 状态上报 |
| `read_artifact` | 读取产物 |
| `write_artifact` | 写产物 |

开放顺序建议：

```text
get_task_detail
→ read_artifact
→ report_task_update
→ invoke_subagent
→ watch_execution_results
```

不要一次性开放所有 tool。

---

## 8. InfTest Prompt 当前策略

### 8.1 query MVP prompt

当前 query 模式应保持简单、强约束：

```text
你是 InfTest Planner/Reflection Agent。
当前只能使用 run_fake_e2e 工具完成任务。
必须调用 run_fake_e2e。
不得自行编造任务结果。
工具返回 SUCCESS 后，总结产物路径和执行结果。
如果没有调用 run_fake_e2e，则任务失败。
```

### 8.2 后续细粒度 prompt

细粒度工具开放后，再升级为：

```text
1. 调用 get_task_detail 获取任务详情。
2. 调用 init_workspace 创建任务工作区。
3. 生成 PlanDAG，并调用 write_plan_dag 保存。
4. 调用 invoke_subagent 执行测试生成。
5. 对测试用例做 Reflection。
6. 调用 invoke_subagent 执行设备调度。
7. 调用 invoke_subagent 启动测试执行。
8. 调用 watch_execution_results 监听执行结果。
9. 调用 invoke_subagent 生成结果分析报告。
10. 调用 report_task_update 上报 SUCCESS 或 FAILED。
```

---

## 9. HTTP API 当前策略

### 9.1 `/tasks/alter`

请求：

```json
{
  "task_id": "task-demo-001",
  "task_operation": "START"
}
```

行为：

| operation | 当前语义 |
|---|---|
| `START` | 根据 `INFTEST_RUNNER` 选择 fake/query |
| `PAUSE` | 记录状态，深度暂停后置 |
| `CONTINUE` | 记录状态，深度恢复后置 |
| `TERMINATE` | 记录状态，尝试终止活跃子进程 |

runner：

```text
INFTEST_RUNNER=fake   → FakeE2ERunner
INFTEST_RUNNER=query  → InfTestQueryRunner + run_fake_e2e tool
```

### 9.2 `/tasks/chat/stream`

当前实现（MVP）：

```text
POST /tasks/chat/stream
→ 查 TaskSession
→ 构造 session context
→ QueryEngine.submitMessage(user_instruction)
→ message_delta 转 SSE
→ tool_start/tool_end 转事件
→ finished=true
```

### 9.3 `GET /tasks/{task_id}`

用于查询任务状态：

```text
GET /tasks/{task_id}
```

返回：

```json
{
  "task_id": "task-demo-001",
  "runner": "query",
  "status": "SUCCESS",
  "workspace": ".inftest-workspace/task-demo-001",
  "artifacts": {
    "plan": ".../plan.json",
    "test_cases": ".../case_generation/test_cases.json",
    "device_bindings": ".../device_scheduling/device_bindings.json",
    "summary": ".../execution/results/summary.json",
    "report": ".../analysis/report.md"
  },
  "last_error": null
}
```

---

## 10. Session 管理

新增或完善：

```text
src/inftest/InfTestSessionManager.ts
```

第一版使用内存 Map。

```ts
type TaskSession = {
  taskId: string;
  sessionId: string;
  runner: "fake" | "query";
  workspace: string;
  status: "PENDING" | "RUNNING" | "PAUSED" | "SUCCESS" | "FAILED" | "TERMINATED";
  startedAt?: string;
  finishedAt?: string;
  lastError?: string;
  runFakeE2EInvoked?: boolean;
  artifacts?: Record<string, string>;
  activeProcessId?: number;
};
```

作用：

- `/task START` 创建或更新 session
- `/task/:task_id` 查询 session
- `/chat/stream` 复用 session
- PAUSE/CONTINUE/TERMINATE 修改 session
- 后续可替换为 Redis

---

## 11. 后续开发优先级

### P0：MVP 收口

1. 统一 fake/query `/task START` 返回结构
2. 新增 `TaskSessionManager`
3. 新增 `GET /tasks/{task_id}`
4. 增加 API e2e 验收脚本：
   - fake 模式
   - query 模式
5. 更新 README 演示说明

### P1：流式交互

1. 实现 `/chat/stream`
2. 将模型输出转 SSE
3. 将工具事件转 SSE
4. 支持 task_id session context
5. 错误时发送 finished=true

### P2：控制语义

1. PAUSE 改 session 状态
2. CONTINUE 恢复 session 状态
3. TERMINATE 尝试 kill active child process
4. 增加测试覆盖

### P3：真实子 Agent 替换

替换顺序：

```text
1. 真实测试生成 Agent
2. 真实结果分析 Agent
3. 真实设备调度 Agent
4. 真实测试执行 Agent
```

执行 Agent 最后接。

### P4：细粒度工具规划

在 `run_fake_e2e` 稳定后，再逐步开放：

```text
get_task_detail
init_workspace
write_plan_dag
invoke_subagent
watch_execution_results
report_task_update
```

---

## 12. 当前不要做的事情

暂时不要做：

```text
1. 大改 queryLoop
2. 把业务子 Agent 放进 CCB forkedAgent/swarm
3. 真实设备控制
4. 真实子 Agent 一次性全接
5. 复杂多轮自主规划
6. 复杂 PAUSE/CONTINUE checkpoint
7. Langfuse/监控/权限系统
8. Web Search / Computer Use / Chrome Use 相关改造
```

---

## 13. 推荐验收命令

```bash
make typecheck
make fake-e2e
make query-e2e
make server
```

API 验收：

```bash
# fake 模式
make server
curl -X POST http://127.0.0.1:8787/tasks/alter \
  -H 'Content-Type: application/json' \
  -d '{"task_id":"task-demo-001","task_operation":"START"}'

# query 模式
INFTEST_RUNNER=query make server
curl -X POST http://127.0.0.1:8787/tasks/alter \
  -H 'Content-Type: application/json' \
  -d '{"task_id":"task-demo-001","task_operation":"START"}'
```

预期：

```json
{
  "task_id": "task-demo-001",
  "runner": "query",
  "status": "SUCCESS",
  "run_fake_e2e_invoked": true,
  "artifacts": {
    "plan": "...",
    "test_cases": "...",
    "device_bindings": "...",
    "summary": "...",
    "report": "..."
  }
}
```

---

## 14. 最终交付物

当前阶段最终应交付：

```text
1. CCB 改造分支
2. InfTestQueryRunner
3. headlessBootstrap
4. run_fake_e2e tool
5. deterministic FakeE2ERunner
6. CLI mock agents
7. HTTP /task API
8. workspace 产物协议
9. fake/query 双模式验收命令
10. README 演示说明
```

交付口径：

> 当前版本完成了嵌入 CCB 的 InfTest 主 Agent MVP。系统支持 deterministic fake 模式和 CCB query 模式两条路径，query 模式可通过 headless QueryEngine 让模型调用 `run_fake_e2e` 工具完成完整 fake 测试闭环，并通过 HTTP `/task START` 对外触发。业务子 Agent 通过 CLI 协议接入，后续可逐步替换为真实测试生成、设备调度、执行和结果分析 Agent。

---

## 15. 最终结论

当前项目已经不再是“探索 CCB 是否可用”的阶段，而是进入 **MVP 收口阶段**。

正确开发方向是：

```text
稳定 fake/query 双路径
→ 统一结果结构
→ 补 session/status 查询
→ 补 /chat/stream
→ 补控制语义
→ 替换真实 CLI 子 Agent
```

最重要的架构判断是：

```text
CCB 内部 subagent 不是业务子 Agent 主链路。
业务子 Agent 应通过 CLI + workspace + output-json 接入。
主 Agent 通过 CCB QueryEngine + InfTest Tools 编排这些 CLI 子 Agent。
```


## 15.1 编排模式（新增）

| `INFTEST_ORCHESTRATION` | 默认 | 含义 |
|---|---|---|
| `aggregate` | 是 | `INFTEST_RUNNER=query` 时仅暴露 `run_fake_e2e`（稳定演示主链路） |
| `stepwise` | 否 | 暴露完整 InfTest tools，模型逐步 `invoke_subagent`（实验） |

文件配置：`.inftest/config.json` 的 `orchestration` 字段，或环境变量 `INFTEST_ORCHESTRATION`。

验收：`make query-e2e` 永远跑 aggregate；`make query-e2e-stepwise` 强制 stepwise（需模型凭证）。

---

## 15.2 CLI 子 Agent output-json 协议（P0）

Mock 与未来真实 Agent 统一写入 `--output-json`：

- 字段：`success`、`agent_name`、`status`（SUCCESS/FAILED/PARTIAL）、`task_id`、`artifacts`、`metrics`、`error`
- Mock 支持 `--mode`、`--delay-ms`、`--input-json`
- `SubAgentAdapter` 负责校验 JSON；timeout 映射 `exit_code=124`

---

## 15.3 Proxy / task_report（可选）

当设置 `INFTEST_PROXY_BASE_URL`（或 `.inftest/config.json` 的 `proxy.base_url`）时，`report_task_update` 走 HTTP `POST {base}/{task_report_path}`；默认路径 `api/inftest/task_report`。未设置时保持本地 stub（accepted）。

---


