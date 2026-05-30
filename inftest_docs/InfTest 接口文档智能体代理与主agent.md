### 智能体代理服务\&lt;\-\&gt;智能体 @柴洪政@罗杰

#### 计划状态

##### 生成计划（Planner Agent Api）

请求方式：POST

请求路径：/api/generate\-plan

调用对象：智能体代理服务

调用时机：智能体代理服务向planner agent请求创建计划表

```JSON
{
  "plan_id": "plan-xxx",
  "plan_name": "登录流程测试计划",
  "project_id": "project-xxx",
  "project_name": "项目名称",

  "prd_file_key": "plans/plan-xxx/prd.docx",
  "prd_file_url": "http://127.0.0.1:9000/inftest/plans/plan-xxx/prd.docx?...",

  "prd_md_file_key": "plans/plan-xxx/prd.md",
  "prd_md_file_url": "http://127.0.0.1:9000/inftest/plans/plan-xxx/prd.md?...",

  "plan_images": [
    {
      "name": "image1",
      "file_key": "plans/plan-xxx/img/1.png",
      "file_url": "http://127.0.0.1:9000/inftest/plans/plan-xxx/img/1.png?...",
      "sort_order": 1
    }
  ],

  "test_env_url": "https://test.example.com",
  "test_strategies": ["FUNCTION", "PERFORMANCE"],
  "remark": "",

  "plan_config_info": {
    "decup_config": {
      "top_k": 5,
      "similarity_threshold": 0.8,
      "max_overlap_checks": 10
    },
    "case_generate_info": {
      "max_depth": 3,
      "included_case_nums": 20
    },
    "case_execution_info": {
      "max_case_retry_num": 2,
      "max_timeout_minutes": 5,
      "max_case_step_num": 20,
      "max_step_thinking_seconds": 30,
      "max_concurrency": 3
    },
    "device_schedule_info": {
      "max_schedule_device_num": 2
    },
    "included_worker_nums": 2,
    "enable_multimodal": false,
    "llm_model_config_id": 0,
    "embedding_model_config_id": 0,
    "multimodal_model_config_id": 0
  }
}
```

```ProtoBuf
message CreateTestPlanRequest {
  string plan_name = 1;             // 计划名称，必填
  string project_id = 2;            // 所属项目/系统ID，必填
  string project_name = 3;          // 项目名称，可选，后端可根据 project_id 补充

  bytes prd_file_key = 4;          // 原始需求文档文件 必填
  string test_env_url = 5;          // 测试环境链接，必填
  repeated string test_strategies = 6; // 测试策略，必填，可多选
  string remark = 7;                // 自然语言补充说明/备注，可选

  [PlanConfigInfo](https://tokfinity.feishu.cn/wiki/JlaywZtz2ivPZ4kzNo4cLOAJnpb#share-Hs2BdOjEnoEfmOx1qSWcb6H1nXb) plan_config_info = 9; // 模型与执行配置，必填
}

// 创建测试计划响应
message CreateTestPlanResponse {
  int32 code = 1;                   // 状态码
  string message = 2;               // 响应消息
  [TestPlan](https://tokfinity.feishu.cn/wiki/JlaywZtz2ivPZ4kzNo4cLOAJnpb#share-RFxqdEB56opoXMx9j5xcXs3enMh) data = 3;              // 创建结果
}
```

##### ✅上报任务计划（Proxy Api）

请求方法：POST

请求路径：api/proxy\-plan\-task\-submit

调用对象：Planner Agent

调用时机：PlannerAgent生成好任务计划后，向代理服务上报

```ProtoBuf
// 测试计划详情上报请求
message ReportTestPlanDetailRequest {
    string plan_id = 1;                         // 测试计划ID，plan_uuid32
    PlanDetailInfo plan_detail = 2;                     // Markdown 测试计划详情，成功时必填
    string failure_reason = 3;                  // 失败原因，失败时必填
}

message PlanDetail {
  string test_objectives = 1;   *// 测试目标*
  string test_scope = 2;        *// 测试范围*
  string test_target = 3;       *// 测试对象*
  string test_environment = 4;  *// 测试环境*
  string resources = 5;         *// 资源与分工*
  string schedule = 6;          *// 进度安排*
  string deliverables = 7;      *// 测试交付物*
}

// 测试计划详情上报响应
message ReportTestPlanDetailResponse {
    string plan_id = 1;                         // 测试计划ID
    TestPlanStatus status = 2;                  // 更新后的测试计划状态
    string message = 3;                         // 处理结果说明
}
```

##### ✅任务状态上报（Proxy Api）

接口说明：接收planner agent上报的任务执行状态、进度、执行结果等信息，更新任务状态及任务详情

请求方式：POST

请求路径：/api/proxy\-update\-task\-status

调用对象：Planner Agent

调用时机：任务执行中agent所产生的输出信息，由planner agent主动上报任务状态给代理服务

```Java
// 任务状态更新请求
message UpdateTaskStatusRequest {
  string task_id = 1;        // 业务任务ID，必填，全局唯一
  AgentName agent_name = 2； //  智能体名称
  TaskStatus task_status = 3;   // 任务状态
  int32 total_tokens = 4;   // 当前阶段token数
  string output_json = 5;       // 中间产物JSON       
  string step_log  = 6;     // 智能体执行日志     
  time.Time start_time = 7;        // 智能体开始时间
  time.Time end_time = 8;          // 智能体结束时间
}

enum TaskStatus {
    PENDING = 0;
    CHECK = 1;                   // 待用户确认
    RUNNING = 2;                 // 执行中
    SUCCESS = 3;                 // 执行成功
    FAILED = 4;                  // 执行失败
    PAUSED = 5;                  // 已暂停
    TERMINATED = 6;              // 已终止
}

enum AgentName {// Agent 名称：用例生成Agent，测试数据Agent，设备调度Agent，用例执行Agent，结果分析Agent
    CASE_GENERATION_AGENT = 1;        // 用例生成 Agent
    TEST_DATA_AGENT = 2;              // 测试数据 Agent
    DEVICE_SCHEDULING_AGENT = 3;      // 设备调度 Agent
    CASE_EXECUTION_AGENT = 4;         // 用例执行 Agent
    RESULT_ANALYSIS_AGENT = 5;        // 结果分析 Agent
}
```

##### 测试用例生成及计划表下发（Planner Agent Api）

请求方式：POST

请求路径：/api/plan\-task\-publish

调用对象：智能体代理服务

调用时机：智能体代理服务向planner发出测试用例生成请求时

```JSON

{
  "plan_id": "plan-xxx",
  "plan_name": "登录流程测试计划",
  "project_id": "project-xxx",
  "project_name": "项目名称",

  "prd_file_key": "plans/plan-xxx/prd.docx",
  "prd_file_url": "http://127.0.0.1:9000/inftest/plans/plan-xxx/prd.docx?...",

  "prd_md_file_key": "plans/plan-xxx/prd.md",
  "prd_md_file_url": "http://127.0.0.1:9000/inftest/plans/plan-xxx/prd.md?...",

  "plan_images": [
    {
      "name": "image1",
      "file_key": "plans/plan-xxx/img/1.png",
      "file_url": "http://127.0.0.1:9000/inftest/plans/plan-xxx/img/1.png?...",
      "sort_order": 1
    }
  ],

  "test_env_url": "https://test.example.com",
  "remark": "用户备注说明",
  "plan_config_info": {
    "decup_config": {
      "top_k": 5,
      "similarity_threshold": 0.8,
      "max_overlap_checks": 10
    },
    "case_generate_info": {
      "max_depth": 3,
      "included_case_nums": 20
    },
    "case_execution_info": {
      "max_case_retry_num": 2,
      "max_timeout_minutes": 5,
      "max_case_step_num": 20,
      "max_step_thinking_seconds": 30,
      "max_concurrency": 3
    },
    "device_schedule_info": {
      "max_schedule_device_num": 2
    },
    "included_worker_nums": 2,
    "enable_multimodal": false,
    "llm_model_config_id": 0,
    "embedding_model_config_id": 0,
    "multimodal_model_config_id": 0
  },

  "plan_detail": {
    "test_objectives": "测试目标",
    "test_scope": "测试范围",
    "test_target": "测试对象",
    "test_environment": "测试环境",
    "resources": "资源与分工",
    "schedule": "进度安排",
    "deliverables": "测试交付物"
  },

  "tasks": [
    {
      "task_id": "task-xxx",
      "task_type": "FUNCTION"
    },
    {
      "task_id": "task-yyy",
      "task_type": "SMOKE"
    }
  ]
}
```

##### 测试用例下发/重启（Planner Agent Api）

请求方法：POST

请求路径：/api/case\-publish

调用对象：代理服务

调用时机：Agent 生成测试用例后，用户检查用例列表，经过新增、修改、删除后，点击“确认执行”按钮后，代理服务会收到后端发来的测试用例，然后代理服务调用该接口把测试用例下发给planner agent。也可以用作重启

```JSON
{
  "plan_id": "plan-xxx",
  "plan_name": "测试计划名称",
  "plan_detail": {
    "test_objectives": "...",
    "test_scope": "...",
    "test_target": "...",
    "test_environment": "...",
    "resources": "...",
    "schedule": "...",
    "deliverables": "..."
  },
  "test_strategies": ["FUNCTIONAL", "INTEGRATION"],
  "test_env_url": "https://test.example.com",
  "plan_config_info": {},
  "exec_id": "exec-xxx",
  "cases": [
    {
      "case_id": "case-xxx",
      "title": "用例名称",
      "conditions": "前置条件",
      "steps": [      
                    {
                        "step_id": "1.1.1",
                        "action": "退到桌面",
                        "expected": "成功退到桌面"
                     },
                    {
                        "step_id": "1.1.2",
                        "action": "打开掌上新华APP",
                        "expected": "APP成功启动并进入首页"
                    },
                    {
                        "step_id": "1.1.3",
                        "action": "点击首页搜索框",
                        "expected": "搜索框可正常聚焦并输入"
                    },
                    {
                        "step_id": "1.1.4",
                        "action": "输入关键字“健康”并执行搜索",
                        "expected": "返回包含关键字相关的搜索结果"
                    },
       ]
    }
  ]
}
```

##### 任务报告生成（planner agent API）

请求方法：POST

请求路径：/api/task\-report\-generate

调用对象：代理服务

调用时机：测试执行结束后，智能体代理服务向planner agent发出任务报告生成请求

```JSON
{
  "plan_id": "plan_xxx",
  "plan_name": "计划名称",
  "plan_detail": {},
  "task_id": "task_xxx",
  "task_name": "任务名称",
  "md_file_key" : "https://xxx",
  "exec_id": "exec_xxx",
  "cases": [
    {
      "case_id": "case_xxx",
      "type": "FUNCTION",
      "case_name": "用例名称",
      "preconditions": "前置条件",
      "test_steps": [
        {
          "id": 1,
          "step": "操作步骤",
          "expected": "预期结果"
        }
      ],
      "status": "COMPLETION",
      "execution_result": "SUCCESS",
      "retry_count": 0,
      "failure_reason": "",
      "step_log_info": [
        {
          "step_idx": 1,
          "logs": "执行日志",
          "snapshot": ["file_key_or_url"]
        }
      ],
      "device_id": "device_xxx",
      "start_time": "2026-05-27 10:00:00",
      "end_time": "2026-05-27 10:05:00"
    }
  ],
  "defects": []
}
```

```ProtoBuf
// 确认生成任务报告请求
message ConfirmGenerateTaskReportRequest {
    string task_id = 1; // 任务业务 ID，必填
}

// 确认生成任务报告响应
message ConfirmGenerateTaskReportResponse {
    int32 code = 1;
    string message = 2;
    ConfirmGenerateTaskReportData data = 3;
}

message ConfirmGenerateTaskReportData {
    string task_id = 1;       // 任务业务 ID
    string task_status = 2;   // 当前任务状态
    string report_status = 3; // 报告生成状态：PENDING/RUNNING/SUCCESS/FAILED
}
```

#### ✅设备操作交互\(代理服务API\)

**接口说明：** http接口，执行agent直接向代理服务发送command payload

**调用****时机****：**执行agent生成payload后要操控手机设备时，先向代理服务发送payload

**调用对象：**执行Agent

**path：****\{ip\}/api/cmd\-bridge/submit  **

```Thrift

struct DeviceActionRequest {
  1: required string user_id      // 触发任务的用户 ID
  2: required string project_id   // 关联的项目/业务线 ID
  3: required string task_id      // 任务 ID
  4: required string device_id    // 目标调度的设备 ID 
  5: optional string case_id      // 当前执行的测试用例 ID
  6: required string step_id      // 当前执行的具体步骤 ID
  7: required string action_id
  8: required [ActionInfo](https://tokfinity.feishu.cn/wiki/JlaywZtz2ivPZ4kzNo4cLOAJnpb#share-UV6QdjnzqoCxnux6P2Gc2uxwnJe) action_info // 具体的动作指令详情
}

struct DeviceActionResponse {
  1: required bool success 
  2: optional string gui_tree
  3: required string message //动作响应
  4: optional binary screenshot //截图
  5: required string task_id
  6: optional string case_id
  7: required string step_id
  8: required string action_id
  
}
```

#### 终止、暂停、继续（planner agent API，计划力度）

**接口说明：** http接口（POST）。智能体代理服务接收到云端任务后，向容器内的主 Agent 发送请求，暂停就是主智能体不再进行下一步，终止是主智能体按逻辑进行kill

**调用时机：**用户想要终止、暂停或继续某个任务时，后端云服务向智能体代理服务发现请求、然后智能体代理服务向PlannerAgent请求终止、暂停或继续任务

**调用对象：**智能体代理服务

**path：**/api/task\-manage

```Markdown
{
  "exec_id": "task-xxx",
  "task_operation": "CONTINUE/PAUSE/TERMINATION"  
}
```

```Thrift
struct TaskRequest {
  1: required string task_id
  2: required string task_operation // START / PAUSE / CONTINUE / TERMINATION 
}

struct TaskResponse {
  1: required string message      
}
```

#### 用户指令注入\(上层PlannerAgentAPI\)

**接口说明**：http接口。用户注入指令，后端云服务向智能体代理发送指令，智能体代理服务再向PlannerAgent发送指令

**调用****时机****： **智能体代理服务向PlannerAgent发送指令

**调用对象：**智能体代理服务

**path：**/api/payload

```JSON
{
  "plan_id": "plan-abc123",
  "user_instruction": "帮我把登录失败、密码错误、账号锁定这些异常场景补充到测试计划里",
  "plan_detail": {
    "test_objectives": "验证登录模块在正常和异常输入下的功能正确性与稳定性。",
    "test_scope": "手机号登录、密码登录、验证码登录、异常提示、账号锁定策略。",
    "test_target": "登录模块",
    "test_environment": "https://test.example.com",
    "resources": "测试人员 1 人，Android 设备 1 台，iOS 设备 1 台。",
    "schedule": "计划 2 个工作日完成用例补充和回归执行。",
    "deliverables": "测试用例、执行结果、缺陷列表。"
  },
  "plan_qa_list": [
    {
      "question": "帮我增加验证码登录相关测试点",
      "answer": "已补充验证码为空、验证码错误、验证码过期、频繁发送验证码等场景。"
    },
    {
      "question": "再补充弱网场景",
      "answer": "已增加弱网、断网恢复、请求超时、重复点击登录按钮等测试点。"
    }
  ]
}
```

```ProtoBuf

// 流式聊天请求
message ChatStreamRequest {
  string user_id = 1;
  string task_id = 2;
  string user_instruction = 3;
}

// 流式聊天响应片段
message ChatStreamResponse {
  int32 code = 1;
  string message = 2;
  ChatStreamData data = 3;
}

// 流式聊天数据
message ChatStreamData {
  string task_id = 1;
  string chunk = 2;       // 本次增量内容
  bool finished = 3;      // 是否结束
  string message_id = 4;  // 消息ID
}
```
