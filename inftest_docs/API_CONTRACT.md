# API_CONTRACT.md — Planner Agent 接口速查

> 本文档只保留 Planner Agent 会**被调用**和**主动调用**的接口，从 Planner 视角精简。
> 数据结构以 Protobuf/Thrift 伪代码表示，实际实现按团队约定序列化。

---

## 一、Planner 被调用的接口（代理服务 → Planner）

Planner 需要暴露以下 HTTP 端点，供代理服务调用。

---

### 1.1 生成计划

```
POST /api/generate-plan
```

**触发时机**：用户在前端创建测试计划后，后端 → 代理服务 → Planner。

**请求体**：
```protobuf
message CreateTestPlanRequest {
  string plan_name = 1;             // 计划名称
  string project_id = 2;            // 项目ID
  string project_name = 3;          // 项目名称
  bytes prd_file_key = 4;           // PRD 文件的 OSS key（需下载获取内容）
  string test_env_url = 5;          // 测试环境 URL
  repeated string test_strategies = 6; // 测试策略：FUNCTIONAL / INTEGRATION / SMOKE
  string remark = 7;                // 用户备注
  PlanConfigInfo plan_config_info = 9; // 完整配置（见下方）
}
```

**响应体**：
```protobuf
message CreateTestPlanResponse {
  int32 code = 1;       // 0=成功
  string message = 2;
}
```

**Planner 收到后做什么**：
1. 下载 PRD → 调 LLM 生成任务列表 → 调用 `plan-task-submit` 上报
2. 此接口立即返回 200，后续异步处理

---

### 1.2 下发任务列表并启动（用户审核通过后）

```
POST /api/batch-execute-tasks
```

**触发时机**：用户审核计划+任务列表后确认执行。

**请求体**：
```protobuf
message BatchExecuteTasksRequest {
  string plan_id = 1;
  repeated ReviewTaskInfo tasks = 2;       // 用户确认的任务
  repeated NewTaskInfo new_tasks = 3;      // 用户新增的任务
  repeated string deleted_task_ids = 4;    // 用户删除的任务ID
}

message ReviewTaskInfo {
  string task_id = 1;
  string task_name = 2;
  TaskType task_type = 3;        // FUNCTIONAL=1, INTEGRATION=2, SMOKE=3
  string task_description = 4;
}

message NewTaskInfo {
  string task_name = 1;
  TaskType task_type = 2;
  string task_description = 3;
}
```

**Planner 收到后做什么**：
1. 合并确认/新增/删除的任务列表
2. 对每个 Task 启动执行流程：用例生成 → 设备调度 → 执行 → 分析

---

### 1.3 下发用户审核后的测试用例

```
POST /api/case-publish
```

**触发时机**：Agent 生成用例后用户审核通过，代理服务将最终用例下发给 Planner。

**请求体**：
```protobuf
message BatchReviewExecuteTestCasesRequest {
  string plan_id = 1;
  string task_id = 2;
  repeated ReviewTestCaseInfo cases = 4;   // 用户确认后的用例列表（结构 TODO）
}
```

**Planner 收到后做什么**：
1. 用下发的用例替换之前生成的用例
2. 继续推进到设备调度阶段

---

### 1.4 暂停/继续/终止任务

```
POST /api/task-manage
```

**请求体**：
```protobuf
message AlterTaskRequest {
  string task_operation = 1;  // "PAUSE" / "CONTINUE" / "FINISH"
  string task_id = 2;
}
```

**Planner 收到后做什么**：
- PAUSE：暂停当前执行的子 Agent
- CONTINUE：恢复执行
- FINISH：终止并清理资源

---

### 1.5 用户指令注入（流式响应）

```
POST /api/payload
```

**请求体**：
```protobuf
message ChatStreamRequest {
  string user_id = 1;
  string task_id = 2;
  string user_instruction = 3;  // 自然语言指令
}
```

**响应体（流式）**：
```protobuf
message ChatStreamResponse {
  int32 code = 1;
  string message = 2;
  ChatStreamData data = 3;
}

message ChatStreamData {
  string task_id = 1;
  string chunk = 2;       // 增量文本内容
  bool finished = 3;      // 是否结束
  string message_id = 4;
}
```

---

## 二、Planner 主动调用的接口（Planner → 代理服务）

Planner 通过 HTTP 主动调用代理服务上报状态和结果。

---

### 2.1 上报生成的任务列表

```
POST {proxy}/api/plan-task-submit
```

**调用时机**：Planner 用 LLM 生成完任务列表后。

**请求体**：
```protobuf
message TasksGenerateRequest {
  string plan_id = 1;
  repeated GeneratedTaskInfo tasks = 2;
}

message GeneratedTaskInfo {
  string task_name = 2;
  TaskType task_type = 3;    // FUNCTIONAL=1, INTEGRATION=2, SMOKE=3
}

enum TaskType {
  TASK_TYPE_UNSPECIFIED = 0;
  FUNCTIONAL = 1;
  INTEGRATION = 2;
  SMOKE = 3;
}
```

**响应体**：
```protobuf
message ReportGeneratedTasksResponse {
  int32 code = 1;
  string message = 2;
  string data = 3;
}
```

---

### 2.2 上报任务阶段状态

```
POST {proxy}/api/task-status-update
```

**调用时机**：任务执行中，每个阶段开始/结束/进度变化时。频繁调用。

**请求体**：
```protobuf
message UpdateTaskStatusRequest {
  string plan_id = 1;
  string task_id = 2;
  AgentName agent_name = 3;     // 当前阶段对应的 Agent
  string task_status = 4;       // CHECK / RUNNING / SUCCESS / FAILED / PAUSED / TERMINATED
  int32 total_tokens = 5;       // 累计 token 数
  string output_json = 6;       // 中间产物 JSON（如用例树、执行进度等）
  string step_log = 7;          // 可读的执行日志
}

enum AgentName {
  AGENT_STATUS_UNSPECIFIED = 0;
  CASE_GENERATION_AGENT = 1;     // 用例生成 Agent
  TEST_DATA_AGENT = 2;           // 测试数据 Agent
  DEVICE_SCHEDULING_AGENT = 3;   // 设备调度 Agent
  CASE_EXECUTION_AGENT = 4;      // 用例执行 Agent
  RESULT_ANALYSIS_AGENT = 5;     // 结果分析 Agent
}
```

---

### 2.3 上报最终计划结果

```
POST {proxy}/api/plan-result-report
```

**调用时机**：所有 Task 执行完成后，Planner 汇总结果一次性上报。

**请求体**：
```protobuf
message ReportPlanResultRequest {
  string plan_id = 1;
  string plan_status = 2;                     // "COMPLETED" / "FAILED"
  map<string, TaskResultInfo> task_info = 3;   // key = task_id
  int32 total_tokens = 4;
  string report_key = 5;                       // OSS 报告文件 key
  repeated DefectInfo defects = 6;
  string start_time = 7;
  string end_time = 8;
}

message TaskResultInfo {
  string task_status = 4;        // SUCCESS / FAILED
  int32 total_tokens = 5;
  string report_file_key = 6;   // 任务报告 OSS key
  string error = 8;             // 失败原因
  string start_time = 7;
  string end_time = 8;
}

message DefectInfo {
  string title = 1;
  string description = 2;
  DefectType defect_type = 4;
  string severity = 5;          // FATAL / SERIOUS / NORMAL / MINOR
  repeated string case_ids = 8;
}

enum DefectType {
  ASSERTION_FAILED = 1;
  RESPONSE_ERROR = 2;
  PERFORMANCE_TIMEOUT = 3;
  UI_ABNORMAL = 4;
  COMPATIBILITY_ISSUE = 5;
  DATA_ERROR = 6;
  SCRIPT_ERROR = 7;
  ENVIRONMENT_ERROR = 8;
  OTHER = 9;
}
```

**响应体**：
```protobuf
message ReportPlanResultResponse {
  int32 code = 1;
  string message = 2;
  ReportPlanResultData data = 3;
}

message ReportPlanResultData {
  string plan_id = 1;
  string plan_status = 2;
  string report_key = 3;
  int32 task_count = 4;
  int32 defect_count = 5;
}
```

---

## 三、Planner 调用子 Agent 的接口（CLI）

所有子 Agent 通过命令行调用，不是 HTTP。

---

### 3.1 用例生成 Agent

**调用方式**：
```bash
cat {req_json_path} | cli_test_plan_agent
```

**请求文件 (req.json)**：
```json
{
  "test_plan_id": 12345,
  "work_item_type_key": "story",
  "project_key": "{project_id}",
  "tenant_key": "xinhua",
  "doc": ["PRD markdown 内容，字符串数组"],
  "type": "functional",
  "user": "xinhua",
  "budget": 500
}
```

**产物获取方式**：轮询日志文件 `./test_case/test_case_generate.json`，逐行 JSON。

**关键 event_type**：
| event_type | 含义 | desc 字段 |
|-----------|------|----------|
| `agent_started` | 开始 | `{ "start_time": "..." }` |
| `case_generation_summary` | 生成统计 | `{ "count": 42 }` |
| `artifact_created` | 用例文件就绪 | `{ "path": "./test_case/cases.json" }` |
| `agent_finished` | 完成 | `{ "end_time": "..." }` |
| `agent_failed` | 失败 | `{ "reason": "..." }` |

**用例树节点结构**：
```protobuf
struct TestCaseNode {
  i64 node_id;
  string title;
  string tag;                    // name / condition / step / result
  list<TestCaseNode> children;
}
```

---

### 3.2 设备调度 Agent

**调用方式**：
```bash
python -m device_agent bind \
  --task-id {task_id} \
  --case-count {case_count}
```

**返回 (stdout JSON)**：
```json
{
  "success": true,
  "device_task_bind": {
    "task_id": "xxx",
    "bind_devices": ["SM02G4061977180", "SM02G40619140446"]
  }
}
```

---

### 3.3 用例执行 Agent

**启动执行**：
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

**device_case_bind.json 格式**：
```json
{
  "device_case": {
    "设备SN号": {
      "case_step": ["步骤1", "步骤2", "..."],
      "case_function_point": "功能点名称",
      "test_scenario": "测试场景",
      "expected_result": ["预期结果1", "预期结果2"],
      "case_id": "case_001"
    }
  }
}
```

**暂停/继续/终止**：
```bash
python task_control_API.py pause --task-id {task_id}
python task_control_API.py resume --task-id {task_id}
python task_control_API.py terminate --task-id {task_id}
```

**返回 (stdout JSON)**：
```json
{
  "user_id": "...",
  "project_id": "...",
  "task_id": "...",
  "task_result_json_path": "./log/{task_id}/result.json"
}
```

**单条用例完成回调（执行 Agent → Planner）**：
```protobuf
struct CaseReportRequest {
  string task_id;
  string project_id;
  i32 case_id;
  string case_result_json_path;
  string status;     // SUCCESS / FAILED / INTERRUPTED
}
```

---

### 3.4 结果分析 Agent

**调用方式**：
```bash
# 具体命令待确认，以下为接口文档中的参数
python -m report_agent run \
  --customer "xinhua" \
  --test-type {functional/integration/smoke} \
  --log-file {task_result_json_path} \
  --doc {prd_doc_path} \
  --output {output_dir} \
  --max-concurrent 3 \
  --single true
```

**环境变量**：
```
REPORT_AGENT_ENABLE_VISION_REQUIREMENT=true
REPORT_AGENT_ENABLE_VISION_ATTRIBUTION=true
REPORT_AGENT_IMAGE_DETAIL=low
```

**日志 event_type**：
| event_type | 含义 |
|-----------|------|
| `task_report_loaded` | 任务报告读取完成 |
| `task_report_load_fail` | 任务报告读取失败 |
| `issue_deduplicate` | 缺陷去重开始 |
| `plan_report_started` | 报告生成开始 |
| `plan_report_finished` | 报告生成完成 |
| `plan_report_failed` | 报告生成失败 |

---

## 四、设备操作接口（执行 Agent 经由代理服务）

执行 Agent 操控设备时通过代理服务的桥接接口，Planner 不直接调用此接口，但需要了解。

```
POST {proxy}/api/cmd-bridge/submit
```

```protobuf
struct DeviceActionRequest {
  string user_id;
  string project_id;
  string task_id;
  string device_id;
  string case_id;        // 可选
  string step_id;
  string action_id;
  ActionInfo action_info; // 具体操作
}

// ActionInfo 可选操作：
//   connect   - 预连接设备
//   tap       - 点击 (x, y)
//   swipe     - 滑动 (x1,y1) → (x2,y2)
//   drag      - 拖拽
//   input_text - 输入文本
//   press_key  - 按键 (keycode)
//   start_app  - 启动应用
//   install_app - 安装 APK
//   screenshot  - 截图（返回 base64）
//   ui_tree     - 获取 UI 控件树

struct DeviceActionResponse {
  bool success;
  string gui_tree;       // UI 树 XML
  string message;
  binary screenshot;     // 截图二进制
  string task_id;
  string case_id;
  string step_id;
  string action_id;
}
```

---

## 五、配置结构速查

```protobuf
message PlanConfigInfo {
  DecupConfigInfo decup_config = 1;
  CaseGenerateInfo case_generate_info = 2;
  CaseExecutionInfo case_execution_info = 3;
  DeviceScheduleInfo device_schedule_info = 4;
  int32 included_worker_nums = 5;           // 单任务最大并行数，默认 8
  bool enable_multimodal = 6;               // 是否启用多模态
  int32 llm_model_config_id = 7;            // 语言模型 ID
  int32 embedding_model_config_id = 8;      // 向量模型 ID
  int32 multimodal_model_config_id = 9;     // 多模态模型 ID
}

message DecupConfigInfo {
  int32 top_k = 1;                          // 去重 top-k
  float similarity_threshold = 2;           // 相似度阈值
  int32 max_overlap_checks = 3;             // 最大去重数
}

message CaseGenerateInfo {
  int32 max_depth = 1;                      // 用例树深度上限
  int32 included_case_nums = 2;             // 单任务最大用例数，默认 500
}

message CaseExecutionInfo {
  int32 max_case_retry_num = 1;             // 最大重试次数，默认 3
  int32 max_timeout_minutes = 2;            // 单步超时(秒)，默认 120
  // 单用例最大步长：50 步
  // 单步模型最大思考时间：90s
}
```

---

## 六、状态枚举速查

**计划状态 (PlanStatus)**：
| 值 | 含义 | 谁触发 |
|---|------|--------|
| `CREATE_TASKS` | 创建任务中 | Planner 生成计划时 |
| `CHECK` | 等待用户审核 | Planner 上报计划后 |
| `RUNNING` | 执行中 | 用户确认后 |
| `COMPLETED` | 已完成 | 所有 Task 完成后 |

**任务状态 (TaskStatus)**：
| 值 | 含义 |
|---|------|
| `CHECK` | 待用户确认 |
| `RUNNING` | 执行中 |
| `SUCCESS` | 成功 |
| `FAILED` | 失败 |
| `PAUSED` | 已暂停 |
| `TERMINATED` | 已终止 |

**阶段状态 (StageStatus)**：
| 值 | 含义 |
|---|------|
| `PENDING` | 待处理 |
| `RUNNING` | 运行中 |
| `SUCCESS` | 成功 |
| `FAILED` | 失败 |
| `CANCEL` | 取消 |
