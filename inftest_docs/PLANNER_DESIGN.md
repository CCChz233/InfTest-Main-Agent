# PLANNER_DESIGN.md — Planner Agent 详细设计

> 本文档描述 Planner Agent 的完整行为逻辑，包括状态机、每个阶段的输入输出、子 Agent 调度策略、错误处理和人机协同节点。

---

## 1. 角色定义

Planner Agent 是整个测试流程的**编排者和总控**，职责：

1. 接收代理服务下发的测试计划请求
2. 调用 LLM 分析 PRD，生成测试计划和任务列表
3. 按顺序编排子 Agent 执行（用例生成 → 设备调度 → 用例执行 → 结果分析）
4. 在每个关键节点向代理服务上报状态
5. 处理用户的审核反馈和指令注入
6. 处理异常、重试和降级

Planner **不直接执行**具体测试操作，它只做编排和调度。

---

## 2. 计划级状态机

```
                    代理服务下发 generate-plan 请求
                                │
                                ▼
                    ┌───────────────────────┐
                    │   PLAN_GENERATING     │  Planner 调用 LLM 生成计划
                    │   (生成计划中)          │
                    └───────────┬───────────┘
                                │ 生成完成，上报 plan-task-submit
                                ▼
                    ┌───────────────────────┐
                    │   PLAN_CHECK          │  等待用户审核计划和任务列表
                    │   (等待用户审核)        │  ← 人机协同节点 #1
                    └───────────┬───────────┘
                                │ 用户确认，代理服务下发 batch-execute-tasks
                                ▼
                    ┌───────────────────────┐
                    │   TASKS_RUNNING       │  按任务逐个/并行执行子流程
                    │   (任务执行中)          │
                    └───────────┬───────────┘
                                │ 所有任务完成
                                ▼
                    ┌───────────────────────┐
                    │   PLAN_COMPLETED      │  上报最终结果
                    │   (计划完成)            │
                    └───────────────────────┘

异常分支：
  任意阶段 → PLAN_FAILED (不可恢复错误)
  TASKS_RUNNING → PAUSED (用户暂停) → TASKS_RUNNING (用户继续)
  TASKS_RUNNING → TERMINATED (用户终止)
```

---

## 3. 单任务级状态机（每个 Task 内部）

一个 Plan 下可能有多个 Task（如 FUNCTIONAL + SMOKE = 2 个 Task）。
每个 Task 独立经历以下阶段：

```
  ┌──────────────────────┐
  │ CASE_GENERATION      │  调用用例生成 Agent
  │ AgentName: 用例生成    │
  └──────────┬───────────┘
             │ 用例生成完成，上报状态
             ▼
  ┌──────────────────────┐
  │ CASE_CHECK           │  等待用户审核用例（可选）
  │                      │  ← 人机协同节点 #2
  └──────────┬───────────┘
             │ 用户确认（或自动跳过），代理服务下发 case-publish
             ▼
  ┌──────────────────────┐
  │ DEVICE_SCHEDULING    │  调用设备调度 Agent
  │ AgentName: 设备调度    │
  └──────────┬───────────┘
             │ 设备分配完成
             ▼
  ┌──────────────────────┐
  │ CASE_EXECUTION       │  调用用例执行 Agent
  │ AgentName: 用例执行    │
  └──────────┬───────────┘
             │ 所有用例执行完毕
             ▼
  ┌──────────────────────┐
  │ RESULT_ANALYSIS      │  调用结果分析 Agent
  │ AgentName: 结果分析    │
  └──────────┬───────────┘
             │ 报告生成完成
             ▼
  ┌──────────────────────┐
  │ TASK_COMPLETED       │
  └──────────────────────┘
```

---

## 4. 各阶段详细设计

### 4.1 阶段一：生成计划 (PLAN_GENERATING)

#### 触发
代理服务调用 `POST /api/generate-plan`，传入 `CreateTestPlanRequest`。

#### 输入
```protobuf
message CreateTestPlanRequest {
  string plan_name = 1;
  string project_id = 2;
  string project_name = 3;
  bytes prd_file_key = 4;         // PRD 文件 key，需从 OSS 下载
  string test_env_url = 5;
  repeated string test_strategies = 6;  // FUNCTIONAL / INTEGRATION / SMOKE
  string remark = 7;
  PlanConfigInfo plan_config_info = 9;
}
```

#### Planner 行为
1. 从 OSS 下载 PRD 的 Markdown 版本（使用 prd_file_key）
2. 构造 LLM prompt，包含：PRD 内容、测试策略列表、备注信息
3. 调用 LLM 生成结构化的任务列表（每个策略对应一个 Task）
4. 调用代理服务 `POST {proxy}/api/plan-task-submit` 上报

#### 输出（上报给代理服务）
```protobuf
message TasksGenerateRequest {
  string plan_id = 1;
  repeated GeneratedTaskInfo tasks = 2;
}

message GeneratedTaskInfo {
  string task_name = 2;        // 如 "登录模块-功能测试"
  TaskType task_type = 3;      // FUNCTIONAL / INTEGRATION / SMOKE
}
```

#### LLM Prompt 策略
```
角色：你是一个专业的软件测试计划制定者。
输入：以下是产品需求文档(PRD)的内容：{prd_content}
要求：
  - 测试策略为：{test_strategies}
  - 为每个策略生成一个测试任务
  - 每个任务包含名称和简要描述
  - 任务名称格式：{模块名}-{策略类型}测试
  - 备注信息：{remark}
输出格式：JSON 数组，每项包含 task_name 和 task_type
```

#### 状态上报
```python
update_task_status(
    plan_id=plan_id,
    task_id="plan_level",
    agent_name=AgentName.PLANNER,
    task_status=TaskStatus.CHECK,    # 进入等待审核
    step_log="计划生成完成，等待用户审核"
)
```

---

### 4.2 阶段二：用例生成 (CASE_GENERATION)

#### 触发
代理服务调用 `POST /api/batch-execute-tasks`，传入用户审核后的任务列表。

#### 输入
```protobuf
message BatchExecuteTasksRequest {
  string plan_id = 1;
  repeated ReviewTaskInfo tasks = 2;        // 用户确认的任务
  repeated NewTaskInfo new_tasks = 3;       // 用户新增的任务
  repeated string deleted_task_ids = 4;     // 用户删除的任务
}
```

#### Planner 行为（对每个 Task）
1. 根据 task_type 构造用例生成请求 JSON 文件
2. 通过 CLI 调用用例生成 Agent：`cat {req.json} | cli_test_plan_agent`
3. 轮询日志文件 `./test_case/test_case_generate.json`，解析 event_type
4. 收到 `artifact_created` 后读取用例文件
5. 收到 `agent_finished` 后，向代理服务上报用例生成结果

#### 请求文件格式 (req.json)
```json
{
  "test_plan_id": 12345,
  "work_item_type_key": "story",
  "project_key": "{project_id}",
  "tenant_key": "xinhua",
  "doc": ["{prd_markdown_content}"],
  "type": "functional",
  "user": "xinhua",
  "budget": 500
}
```

#### 日志轮询逻辑
```python
async def poll_case_generation_log(log_path: str, task_id: str):
    """逐行读取 JSON 日志，驱动状态更新"""
    last_pos = 0
    while True:
        with open(log_path, 'r') as f:
            f.seek(last_pos)
            for line in f:
                event = json.loads(line.strip())
                match event["event_type"]:
                    case "agent_started":
                        report_status(task_id, AgentName.CASE_GENERATION, "RUNNING")
                    case "case_generation_summary":
                        count = event["desc"]["count"]
                        report_status(task_id, AgentName.CASE_GENERATION, "RUNNING",
                                      step_log=f"已生成 {count} 条用例")
                    case "artifact_created":
                        artifact_path = event["desc"]["path"]
                        # 读取用例文件，后续上报
                    case "agent_finished":
                        report_status(task_id, AgentName.CASE_GENERATION, "SUCCESS")
                        return artifact_path
                    case "agent_failed":
                        reason = event["desc"]["reason"]
                        report_status(task_id, AgentName.CASE_GENERATION, "FAILED",
                                      step_log=reason)
                        raise AgentFailedError(reason)
            last_pos = f.tell()
        await asyncio.sleep(2)  # 轮询间隔
```

#### 状态上报
使用 `UpdateTaskStatusRequest` 上报：
- `agent_name`: `CASE_GENERATION_AGENT`
- `task_status`: RUNNING → SUCCESS / FAILED
- `output_json`: 用例树的 JSON 数据

---

### 4.3 阶段三：设备调度 (DEVICE_SCHEDULING)

#### 触发
用例生成完成后（或用户审核用例通过后），Planner 自动推进。

#### Planner 行为
1. 计算用例总数
2. CLI 调用设备调度 Agent：
   ```bash
   python -m device_agent bind \
     --task-id {task_id} \
     --case-count {case_count}
   ```
3. 解析返回 JSON，获取分配的设备列表
4. 构造 device-case 绑定关系

#### 输出（设备调度 Agent 返回）
```json
{
  "success": true,
  "device_task_bind": {
    "task_id": "xxx",
    "bind_devices": ["SM02G4061977180", "SM02G40619140446"]
  }
}
```

#### 用例分片策略
```python
def distribute_cases(cases: list, devices: list) -> dict:
    """将用例均匀分配到设备上"""
    device_case_bind = {}
    for i, case in enumerate(cases):
        device_id = devices[i % len(devices)]
        if device_id not in device_case_bind:
            device_case_bind[device_id] = []
        device_case_bind[device_id].append(case)
    return device_case_bind
```

---

### 4.4 阶段四：用例执行 (CASE_EXECUTION)

#### 触发
设备调度完成后，Planner 自动推进。

#### Planner 行为
1. 构造 device_case_bind.json 文件
2. CLI 调用执行 Agent：
   ```bash
   python run_API.py execute \
     --user-id {user_id} \
     --project-id {project_id} \
     --task-id {task_id} \
     --device-case-bind @./device_case_bind.json \
     --used-model {model_name} \
     --enable-multimodal-assertion {true/false} \
     --enable-multimodal-attribution {true/false}
   ```
3. 轮询执行日志，跟踪进度
4. 接收子 Agent 的 CaseReportRequest 回调（单条用例完成）
5. 汇总执行结果

#### 进度跟踪
```python
progress = completed_cases / total_cases
report_status(
    task_id=task_id,
    agent_name=AgentName.CASE_EXECUTION,
    task_status="RUNNING",
    step_log=f"已执行 {completed_cases}/{total_cases} 条用例",
    output_json=json.dumps({"progress": progress})
)
```

#### 重试策略
```python
max_retry = plan_config.case_execution_info.max_case_retry_num  # 默认 3

for case in cases:
    for attempt in range(max_retry + 1):
        result = execute_case(case)
        if result.status == "SUCCESS":
            break
        if attempt == max_retry:
            mark_case_failed(case, result)
```

#### 暂停/继续/终止处理
Planner 维护一个全局 `task_control_state` 字典：

```python
task_control_state = {}  # task_id -> "RUNNING" | "PAUSED" | "TERMINATED"

async def handle_task_manage(request: AlterTaskRequest):
    match request.task_operation:
        case "PAUSE":
            task_control_state[request.task_id] = "PAUSED"
            # 调用执行 Agent 暂停
            subprocess.run(f"python task_control_API.py pause --task-id {request.task_id}")
        case "CONTINUE":
            task_control_state[request.task_id] = "RUNNING"
            subprocess.run(f"python task_control_API.py resume --task-id {request.task_id}")
        case "FINISH":
            task_control_state[request.task_id] = "TERMINATED"
            subprocess.run(f"python task_control_API.py terminate --task-id {request.task_id}")
```

---

### 4.5 阶段五：结果分析与报告 (RESULT_ANALYSIS)

#### 触发
所有用例执行完毕后，Planner 自动推进。

#### Planner 行为
1. 收集执行结果日志
2. CLI 调用结果分析 Agent，传入：
   - 测试日志文件
   - PRD 文档路径
   - 输出目录
   - 是否开启多模态归因
3. 轮询结果分析日志
4. 生成最终报告后上传 OSS
5. 调用代理服务 `POST {proxy}/api/plan-result-report` 上报

#### 最终上报数据
```protobuf
message ReportPlanResultRequest {
  string plan_id = 1;
  string plan_status = 2;                    // "COMPLETED"
  map<string, TaskResultInfo> task_info = 3;
  int32 total_tokens = 4;
  string report_key = 5;                     // OSS 报告文件 key
  repeated DefectInfo defects = 6;           // 缺陷列表
  time.Time start_time = 7;
  time.Time end_time = 8;
}
```

---

## 5. 人机协同节点

Planner 有两个需要等待用户操作的节点：

| 节点 | 触发条件 | Planner 行为 | 恢复触发 |
|------|----------|-------------|----------|
| #1 计划审核 | 计划和任务列表生成完毕 | 上报后暂停，不继续往下执行 | 代理服务调用 `batch-execute-tasks` |
| #2 用例审核 | 用例生成完毕 | 上报后暂停（状态 CHECK） | 代理服务调用 `case-publish` |

实现方式：使用 `asyncio.Event` 或消息队列等待信号。

```python
class PlanContext:
    def __init__(self, plan_id: str):
        self.plan_id = plan_id
        self.review_event = asyncio.Event()     # 计划审核信号
        self.case_review_events = {}            # task_id -> Event，用例审核信号

    async def wait_for_plan_review(self):
        """阻塞直到用户审核通过"""
        await self.review_event.wait()

    def on_plan_reviewed(self, tasks: list):
        """代理服务调用 batch-execute-tasks 时触发"""
        self.reviewed_tasks = tasks
        self.review_event.set()
```

---

## 6. 用户指令注入

用户可以在任务执行过程中注入自然语言指令。

#### 接口
```protobuf
message ChatStreamRequest {
  string user_id = 1;
  string task_id = 2;
  string user_instruction = 3;   // 如 "跳过登录模块的测试" / "增加边界值测试"
}
```

#### Planner 行为
1. 接收指令
2. 结合当前任务上下文，调用 LLM 理解指令意图
3. 转化为具体操作（如调整用例范围、暂停某个子 Agent、修改执行参数）
4. 以流式响应返回执行结果

---

## 7. Token 记账

Planner 需要在每次 LLM 调用后累积 Token 消耗：

```python
class TokenTracker:
    def __init__(self):
        self.tokens = {}  # (task_id, agent_name) -> total_tokens

    def add(self, task_id: str, agent_name: str, tokens: int):
        key = (task_id, agent_name)
        self.tokens[key] = self.tokens.get(key, 0) + tokens

    def get_task_total(self, task_id: str) -> int:
        return sum(v for (tid, _), v in self.tokens.items() if tid == task_id)

    def get_plan_total(self) -> int:
        return sum(self.tokens.values())
```

上报时机：每次 `UpdateTaskStatusRequest` 时携带 `total_tokens` 字段。

---

## 8. 错误处理策略

| 错误场景 | 处理方式 |
|----------|---------|
| LLM 调用超时 | 重试 2 次，间隔 5 秒递增；仍失败则标记 FAILED |
| 子 Agent 进程崩溃 (exit code != 0) | 记录日志，上报 FAILED，携带 stderr 信息 |
| 子 Agent 日志中出现 `agent_failed` | 读取 desc.reason，上报 FAILED |
| 设备调度失败（设备不足） | 上报 FAILED，step_log 说明可用设备不足 |
| 单条用例执行超时 | 按 max_timeout_minutes 配置超时；超时后重试 |
| 用例重试 N 次仍失败 | 标记该用例为 FAILED，继续执行下一条 |
| PRD 文件下载失败 | 重试 2 次；失败则上报 FAILED |
| 代理服务接口调用失败 | 重试 3 次，指数退避；仍失败则本地缓存，后续补报 |

---

## 9. 并发模型

```python
# Plan 级别：单个 Plan 内的多个 Task 可以并行执行
# Task 级别：单个 Task 内的用例执行可以并行（受 included_worker_nums 限制）

async def execute_plan(plan_id: str, tasks: list):
    """并行执行所有 Task"""
    semaphore = asyncio.Semaphore(len(tasks))  # 所有 Task 并行
    await asyncio.gather(*[
        execute_task(task, semaphore) for task in tasks
    ])

async def execute_task(task: TaskInfo, semaphore):
    """单个 Task 的执行流程（内部各阶段串行）"""
    async with semaphore:
        await run_case_generation(task)
        await wait_for_case_review(task)     # 人机协同节点
        devices = await run_device_scheduling(task)
        await run_case_execution(task, devices)
        await run_result_analysis(task)
```

---

## 10. 核心数据结构

```python
from enum import Enum
from dataclasses import dataclass, field
from typing import Optional

class PlanStatus(Enum):
    GENERATING = "GENERATING"
    CHECK = "CHECK"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    PAUSED = "PAUSED"
    TERMINATED = "TERMINATED"

class TaskStageEnum(Enum):
    CASE_GENERATION = "CASE_GENERATION"
    CASE_CHECK = "CASE_CHECK"
    DEVICE_SCHEDULING = "DEVICE_SCHEDULING"
    CASE_EXECUTION = "CASE_EXECUTION"
    RESULT_ANALYSIS = "RESULT_ANALYSIS"
    COMPLETED = "COMPLETED"

class AgentName(Enum):
    CASE_GENERATION_AGENT = 1
    TEST_DATA_AGENT = 2
    DEVICE_SCHEDULING_AGENT = 3
    CASE_EXECUTION_AGENT = 4
    RESULT_ANALYSIS_AGENT = 5

@dataclass
class PlanContext:
    plan_id: str
    plan_name: str
    project_id: str
    project_name: str
    prd_content: str                    # PRD markdown 内容
    test_env_url: str
    test_strategies: list[str]
    remark: str
    config: "PlanConfigInfo"
    status: PlanStatus = PlanStatus.GENERATING
    tasks: list["TaskContext"] = field(default_factory=list)
    total_tokens: int = 0
    start_time: Optional[str] = None
    end_time: Optional[str] = None

@dataclass
class TaskContext:
    task_id: str
    task_name: str
    task_type: str                      # FUNCTIONAL / INTEGRATION / SMOKE
    plan_id: str
    current_stage: TaskStageEnum = TaskStageEnum.CASE_GENERATION
    status: str = "PENDING"
    cases: list = field(default_factory=list)        # 生成的用例列表
    devices: list[str] = field(default_factory=list) # 分配的设备列表
    device_case_bind: dict = field(default_factory=dict)
    defects: list = field(default_factory=list)
    total_tokens: int = 0
    report_key: str = ""
    start_time: Optional[str] = None
    end_time: Optional[str] = None
```

---

## 11. 模块划分建议

```
planner/
├── main.py                    # FastAPI 入口，注册所有 HTTP 端点
├── config.py                  # 配置加载（代理服务地址、OSS配置等）
├── models.py                  # 数据结构定义（PlanContext, TaskContext 等）
├── state_machine.py           # 计划和任务状态机
├── plan_generator.py          # 阶段一：LLM 生成计划和任务列表
├── case_generation.py         # 阶段二：调度用例生成 Agent + 日志轮询
├── device_scheduling.py       # 阶段三：调度设备调度 Agent
├── case_execution.py          # 阶段四：调度执行 Agent + 进度跟踪
├── result_analysis.py         # 阶段五：调度结果分析 Agent + 报告上传
├── proxy_client.py            # 代理服务 HTTP Client（封装所有上报接口）
├── sub_agent_runner.py        # 子 Agent CLI 调用 + 日志轮询 通用逻辑
├── token_tracker.py           # Token 记账
├── llm_client.py              # LLM 调用封装
├── oss_client.py              # OSS 文件操作封装
├── prompts/
│   ├── plan_generation.py     # 计划生成 prompt 模板
│   └── instruction_parse.py   # 用户指令解析 prompt 模板
├── tests/
│   ├── test_plan_generator.py
│   ├── test_case_generation.py
│   └── ...
└── requirements.txt
```
