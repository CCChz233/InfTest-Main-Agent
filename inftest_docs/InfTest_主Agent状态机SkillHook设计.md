# InfTest 主 Agent 状态机 / Skill / Hook 设计

> 日期：2026-05-27  
> 目的：把主 Agent 从脚本式 E2E 收敛为可长期开发的状态机驱动架构。  
> 当前口径：这是目标设计，不是当前已全部实现的现状。

## 1. 核心结论

主 Agent 应按三层拆分：

```text
StateMachine controls workflow
Skill executes business capability
Adapter calls real sub Agent CLI
Hook records / validates / reports side effects
```

不要让 hook 决定主业务流程。hook 只做旁路动作，例如日志、校验、上报、审计、错误落盘。

主流程应由显式状态机控制：

```text
HTTP START
  -> create task session
  -> PLANNING
  -> DATA_GEN
  -> COORDINATE
  -> EXECUTING
  -> REFLECTING
  -> COMPLETED / SUCCESS
```

当前 `available` runner 已经能跑出这个顺序，但还是脚本式步骤，不是统一状态机。

## 2. 状态集合

### 2.1 task_status

任务生命周期状态：

```text
PENDING
RUNNING
PAUSED
SUCCESS
FAILED
TERMINATED
```

建议语义：

| 状态 | 含义 |
|---|---|
| `PENDING` | 已创建但尚未开始执行。当前代码基本未使用。 |
| `RUNNING` | 主 Agent 正在执行某个业务阶段。 |
| `PAUSED` | 用户暂停，当前任务不应继续推进到下一个阶段。 |
| `SUCCESS` | 全部阶段完成，关键产物齐全。 |
| `FAILED` | 任意阶段不可恢复失败。 |
| `TERMINATED` | 用户主动终止。 |

### 2.2 current_stage

业务执行阶段：

```text
PLANNING
DATA_GEN
COORDINATE
EXECUTING
REFLECTING
COMPLETED
```

建议语义：

| 阶段 | 主职责 | 核心产物 |
|---|---|---|
| `PLANNING` | 生成测试计划 DAG | `plan.json` |
| `DATA_GEN` | 生成或加载测试用例；当前先用静态用例 | `case_generation/test_cases.json` |
| `COORDINATE` | 设备和用例绑定 | `device_scheduling/device_case_bind.json` |
| `EXECUTING` | CLI 调用执行 Agent | `execution/results/case_result.json`, `summary.json` |
| `REFLECTING` | CLI 调用报告 Agent | `analysis/report.md` |
| `COMPLETED` | 汇总产物并上报最终状态 | task update |

### 2.3 建议补充字段

当前 `TaskSession` 只有 `status`，没有持久化 `current_stage`。建议扩展：

```ts
type TaskSession = {
  task_id: string
  runner: 'fake' | 'query' | 'available'
  status: TaskStatus
  current_stage: InfTestStage | null
  previous_stage: InfTestStage | null
  active_skill: string | null
  blocking_reason: string | null
  instruction_queue: UserInstructionEvent[]
  stage_history: StageTransitionRecord[]
  artifacts: Record<string, string>
  workspace: string
  started_at: string
  finished_at: string | null
  last_error: string | null
}
```

`WAITING_USER` 不建议先放进 `task_status`。如果需要等待人工审核或用户输入，先用：

```text
status = RUNNING 或 PAUSED
blocking_reason = "WAITING_USER_CASE_REVIEW"
```

## 3. 状态转移

### 3.1 正常转移

```text
START
  -> RUNNING + PLANNING

PLANNING success
  -> DATA_GEN

DATA_GEN success
  -> COORDINATE

COORDINATE success
  -> EXECUTING

EXECUTING success
  -> REFLECTING

REFLECTING success
  -> COMPLETED
  -> SUCCESS
```

### 3.2 控制转移

| 事件 | 当前状态 | 目标状态 | 行为 |
|---|---|---|---|
| `PAUSE` | `RUNNING` | `PAUSED` | 记录暂停，不进入下一阶段。 |
| `CONTINUE` | `PAUSED` | `RUNNING` | 从暂停前阶段继续。 |
| `TERMINATE` | `RUNNING` / `PAUSED` | `TERMINATED` | abort query，kill running sub agent。 |
| `RESTART` | `SUCCESS` / `FAILED` / `TERMINATED` | `RUNNING + PLANNING` | 新建或重置 session 后重跑。 |

当前代码已支持 `PAUSE` / `CONTINUE` / `TERMINATE` 的 MVP 状态改写，但没有完整非法转移校验，也没有 `RESTART`。

### 3.3 失败转移

任意阶段失败：

```text
RUNNING + <stage>
  -> FAILED
  -> write last_error
  -> collect logs/artifacts
  -> report task update
```

失败来源包括：

- 必要输入产物缺失。
- 子 Agent CLI 非 0 退出。
- 子 Agent output-json 校验失败。
- 执行 Agent 未生成 `case_result.json`。
- 报告 Agent 未生成 `report.md`。
- 模型 API 不可用。
- 超时。
- 用户终止。

## 4. Skill 设计

Skill 是主 Agent 的业务能力单元。每个 stage 进入后调用一个或多个 skill。

| Stage | Skill | Adapter / 调用对象 | 输入 | 输出 |
|---|---|---|---|---|
| `PLANNING` | `PlanSkill` | 本地逻辑 / 后续可接计划 Agent | task detail, requirement doc | `plan.json` |
| `DATA_GEN` | `CaseGenerationSkill` | 当前静态用例；后续 CLI 调 `cli_test_plan_agent` | `plan.json` | `test_cases.json` |
| `COORDINATE` | `DeviceCoordinateSkill` | 本地逻辑；后续可接设备调度 Agent | `test_cases.json`, device info | `device_case_bind.json` |
| `EXECUTING` | `ExecutionSkill` | CLI 调 `gui-tester/run_API.py` | `device_case_bind.json` | `case_result.json`, `summary.json` |
| `REFLECTING` | `ReportSkill` | CLI 调 `inftest-report-agent/run_report.py` | `case_result.json`, requirement doc | `report.md`, docx |
| `COMPLETED` | `FinalizeSkill` | ProxyClient | artifacts, final status | task update |

建议接口：

```ts
type SkillInput = {
  task_id: string
  workspace: string
  session: TaskSession
  signal?: AbortSignal
}

type SkillResult = {
  status: 'SUCCESS' | 'FAILED'
  artifacts: Record<string, string>
  message?: string
  error?: {
    code: string
    message: string
  }
}

interface InfTestSkill {
  name: string
  stage: InfTestStage
  run(input: SkillInput): Promise<SkillResult>
}
```

## 5. Hook 设计

Hook 用于旁路动作，不负责决定主流程。

建议 hook 点：

```text
onTaskStart
onEnterStage
beforeSkillCall
afterSkillCall
onSkillError
beforeStageTransition
afterStageTransition
onUserInstruction
onTaskFinish
```

建议职责：

| Hook | 作用 |
|---|---|
| `onTaskStart` | 写 HTTP request、初始化 experiment 目录。 |
| `onEnterStage` | 写 state transition log，上报 current_stage。 |
| `beforeSkillCall` | 校验输入产物是否存在。 |
| `afterSkillCall` | 收集 artifacts，写 invocation summary。 |
| `onSkillError` | 写 error log，补充 last_error。 |
| `beforeStageTransition` | 校验当前状态是否允许转移。 |
| `afterStageTransition` | 上报阶段完成。 |
| `onUserInstruction` | 记录用户指令事件，不直接改主流程。 |
| `onTaskFinish` | 写 final summary，上报最终 SUCCESS/FAILED。 |

建议 hook event 结构：

```ts
type InfTestHookEvent = {
  task_id: string
  event_id: string
  event_type: string
  stage: InfTestStage | null
  status: TaskStatus
  timestamp: string
  payload: Record<string, unknown>
}
```

## 6. 用户 Prompt 注入

用户 prompt 注入不是一个状态，而是事件：

```text
USER_INSTRUCTION_RECEIVED
```

当前 `/tasks/chat/stream` 只是问答式响应，不会真正改变正在执行的任务链路。目标设计中应拆成三类：

### 6.1 控制类指令

示例：

```text
暂停
继续
终止
重跑
```

处理：

| 指令 | 行为 |
|---|---|
| 暂停 | 转 `PAUSED` |
| 继续 | 从 `PAUSED` 转 `RUNNING` |
| 终止 | 转 `TERMINATED`，停止子 Agent |
| 重跑 | 后续支持 `RESTART` |

### 6.2 业务类指令

示例：

```text
增加登录失败用例
不要测搜索
报告重点分析失败原因
```

处理：

```text
写入 instruction_queue
在下一个 safe point 处理
```

safe point 建议：

- 进入下一个 stage 前。
- 调子 Agent 前。
- 报告生成前。
- 当前子 Agent 完成后。

不要在子 Agent 正在执行中硬改输入文件，除非子 Agent 明确支持热更新。

### 6.3 问答类指令

示例：

```text
现在任务到哪一步了？
为什么失败？
有哪些产物？
```

处理：

```text
只读取 session/artifacts/logs 做回答
不改变 task_status/current_stage
```

### 6.4 终态任务的用户注入

如果任务已经：

```text
SUCCESS / FAILED / TERMINATED
```

默认只允许解释、总结、读取产物。不要修改状态。

## 7. 日志与实验轨迹

每次 START 建议落地：

```text
.inftest-workspace/<task_id>/experiment/http_start_request.json
.inftest-workspace/<task_id>/experiment/http_start_response.json
.inftest-workspace/<task_id>/experiment/state_transitions.jsonl
.inftest-workspace/<task_id>/experiment/skill_invocations.jsonl
.inftest-workspace/<task_id>/experiment/hooks.jsonl
.inftest-workspace/<task_id>/experiment/user_instructions.jsonl
.inftest-workspace/<task_id>/experiment/proxy_updates.jsonl
.inftest-workspace/<task_id>/experiment/summary.md
```

这部分用于 Postman 实验复盘，也用于后续根据主 Agent 表现调 prompt / skill / adapter。

## 8. 当前代码映射

当前已有：

- `TaskStatus` schema。
- `InfTestStage` schema。
- `POST /tasks/alter START/PAUSE/CONTINUE`。
- `POST /tasks/terminate`。
- `TaskSessionManager` 记录 session。
- `AvailableAgentsRunner` 脚本式执行真实 CLI adapter。
- `SubAgentAdapter` CLI 调子 Agent。
- `inftest_real_execution_agent_adapter.py`。
- `inftest_real_report_agent_adapter.py`。
- `/tasks/chat/stream` 问答式用户指令入口。

当前缺口：

- `TaskSession.current_stage` 未持久化。
- 没有显式 StateMachine。
- 没有 SkillRegistry。
- 没有 HookManager。
- 没有 instruction queue。
- 没有非法状态转移校验。
- 没有 `RESTART`。
- `/tasks/chat/stream` 不会改变业务执行链路。
- `available` runner 仍是脚本式 runner，尚未拆成状态机 + skills。

## 9. 建议开发顺序

### Phase 1：状态机骨架

1. 扩展 `TaskSession`：
   - `current_stage`
   - `previous_stage`
   - `active_skill`
   - `blocking_reason`
   - `stage_history`
2. 新增 `InfTestStateMachine`。
3. 把 `AvailableAgentsRunner` 的顺序步骤迁移到状态机中。
4. 每次 stage 切换写 `state_transitions.jsonl`。

### Phase 2：SkillRegistry

1. 新增 `skills/`：
   - `PlanSkill`
   - `StaticCaseGenerationSkill`
   - `DeviceCoordinateSkill`
   - `ExecutionSkill`
   - `ReportSkill`
   - `FinalizeSkill`
2. 每个 skill 只关心自己的输入/输出。
3. adapter 继续保持独立，不合并子 Agent 代码。

### Phase 3：HookManager

1. 新增 `HookManager`。
2. 实现：
   - experiment log hook
   - proxy report hook
   - artifact collect hook
   - error hook
3. hooks 不直接决定下一阶段。

### Phase 4：用户指令注入

1. 新增 `instruction_queue`。
2. `/tasks/chat/stream` 保持问答。
3. 新增或扩展用户指令接口，区分：
   - control
   - business_update
   - question
4. 在 safe point 消费业务指令。

### Phase 5：平台接口对齐

1. 和 Agent Service 确认状态字段。
2. 确认是否需要 `/api/generate-plan`、`/api/case-publish`。
3. 补 `RESTART`。
4. 补完整 Postman 用例和断言。

## 10. 仍需确认的信息

1. 真实模型 API：
   - `BASE_URL`
   - `MODEL`
   - `API_KEY`
2. Agent Service 接收哪些状态字段：
   - 只收 `task_status`
   - 是否也收 `current_stage`
3. 用户 prompt 注入最终接口：
   - 是否继续用 `/tasks/chat/stream`
   - 是否有单独的用户指令注入接口
4. 用例生成 Agent 是否继续暂不接。
5. 设备 mock 验收口径：
   - 当前建议只 mock 设备，不 mock执行 Agent CLI、不 mock报告 Agent。

## 11. 当前全真模拟口径

当前用户已确认暂无真实设备，因此推荐：

```text
只 mock device
不 mock 主 Agent
不 mock gui-tester/run_API.py
不 mock inftest-report-agent/run_report.py
```

当前链路状态：

```text
HTTP START
  -> 主 Agent available
  -> 真实 gui-tester/run_API.py
  -> gui-tester API with INFTEST_MOCK_DEVICE=1
  -> case_result.json / summary.json 已可生成
  -> 真实 report-agent
  -> 当前卡在真实模型 API Connection error
```
