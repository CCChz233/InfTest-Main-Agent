# InfTest 主 Agent 接口交互专用文档

> 日期：2026-05-27  
> 来源：`/Users/chz/workspace/inftest-runtime/docs/InfTest 接口文档 (1).md`  
> 用途：只整理和 InfTest 主 Agent 直接相关的通信对象、接口和 Postman 真实 HTTP 实验路径。

## 1. 主 Agent 的位置

原接口文档里的主 Agent 对应的是 **Planner Agent**。

领导确认口径：

```text
主 Agent 的 HTTP 直接交互对象只有智能体代理服务 Agent Service。
```

后端云服务、前端、设备服务都不直接调用主 Agent。后端云服务通过智能体代理服务把请求转给主 Agent；主 Agent 的状态和结果也先上报给智能体代理服务，再由代理服务落库或转发给后端。

它不直接面对前端页面，也不直接操控手机设备。它的位置是：

```text
前端 Web Client
  -> 后端云服务
  -> 智能体代理服务 Agent Service
  -> InfTest 主 Agent / Planner Agent
  -> 子 Agent（CLI）
  -> 执行 Agent 再通过代理服务操控设备
```

本机联调里，`mock backend` 同时模拟了：

```text
后端云服务 + 智能体代理服务
```

但从主 Agent 的接口边界看，它只应该把这个 mock 服务当成 **智能体代理服务**。

所以 Postman 实验应该优先打 mock 后端端口，而不是直接打主 Agent 内部端口。

## 2. 主 Agent 和谁交互

### 2.1 上游：智能体代理服务

智能体代理服务调用主 Agent，用来：

- 生成测试计划。
- 启动、暂停、继续、终止、重启任务。
- 下发用户审核后的测试用例。
- 注入用户自然语言指令。

这类接口是 **Planner Agent API**，也就是主 Agent 需要暴露的 HTTP 接口。

### 2.2 回调对象：智能体代理服务

主 Agent 执行过程中会主动回调智能体代理服务，用来：

- 上报测试计划详情。
- 上报任务阶段状态。
- 上传报告文件。
- 上报计划最终结果。

这类接口是 **Proxy API**，也就是主 Agent 主动调用智能体代理服务的 HTTP 接口。后端云服务是否落库、是否继续转发，不属于主 Agent 的直接交互边界。

### 2.3 下游：子 Agent

主 Agent 通过 CLI 调用子 Agent：

- 用例生成 Agent：`cli_test_plan_agent`
- 设备调度 Agent：`device_agent`
- 用例执行 Agent：`gui-tester / run_API.py`
- 结果分析/报告 Agent：`inftest-report-agent / run_report.py`

这些不是 HTTP 调用。

### 2.4 设备代理服务

设备命令接口：

```text
POST /api/cmd-bridge/submit
```

调用方不是主 Agent，而是执行 Agent。

主 Agent 只负责把用例和设备绑定关系交给执行 Agent，不直接点击、滑动、截图或读取 UI 树。

## 3. 主 Agent 被调用接口

这些接口是“代理服务 -> 主 Agent”。

### 3.1 生成计划

文档位置：`智能体代理服务<->智能体 / 生成计划（Planner Agent Api）`

建议路径：

```text
POST /api/generate-plan
```

文档下方该接口路径为空，但前文“确认文档解析”明确提到后端调用代理服务生成计划为：

```text
api/generate-plan
```

请求体核心字段：

```json
{
  "plan_name": "登录流程测试计划",
  "project_id": "xh",
  "project_name": "新华",
  "prd_file_key": "oss/prd.docx",
  "test_env_url": "https://test.example.com",
  "test_strategies": ["FUNCTIONAL"],
  "remark": "重点覆盖登录、搜索、报告生成",
  "plan_config_info": {}
}
```

主 Agent 应做：

```text
读取需求文档
生成 PlanDetail / 任务列表
调用 Proxy API 上报计划详情或任务计划
```

当前代码状态：

```text
尚未实现该入口。
当前主线先做任务 START 链路。
```

### 3.2 启动、暂停、继续、终止、重启任务

文档位置：

```text
智能体代理服务<->智能体 / 启动、终止、暂停、继续、重启计划
任务管理模块 / POST /api/tasks/alter
```

文档里的任务操作：

```text
START
PAUSE
CONTINUE
TERMINATION
RESTART
```

面向 Postman 的推荐入口：

```text
POST http://127.0.0.1:8790/api/task-manage
```

兼容当前已实现入口：

```text
POST http://127.0.0.1:8790/api/tasks/alter
```

请求体：

```json
{
  "task_id": "task-postman-001",
  "task_operation": "START"
}
```

主 Agent 应做：

```text
START:
  创建本地 task session
  获取任务详情
  进入 query/stepwise 或 available runner
  调子 Agent
  上报阶段状态
  返回最终状态

PAUSE:
  标记任务暂停

CONTINUE:
  标记任务继续

TERMINATION:
  终止主 Agent 当前任务
  中止运行中的子 Agent
```

当前代码状态：

```text
主 Agent 已实现 POST /tasks/alter
mock 后端已实现 POST /api/tasks/alter
mock 后端尚未实现 /api/task-manage 别名
```

### 3.3 测试用例下发

文档位置：`测试用例下发（Planner Agent Api）`

建议路径：

```text
POST /api/case-publish
```

调用时机：

```text
Agent 生成用例后，用户审核、编辑、确认执行。
代理服务把最终用例列表下发给主 Agent。
```

请求体核心字段：

```json
{
  "plan_id": "plan-postman-001",
  "task_id": "task-postman-001",
  "cases": [
    {
      "case_id": "case-login-001",
      "case_name": "登录成功",
      "case_status": "PENDING"
    }
  ]
}
```

主 Agent 应做：

```text
用用户审核后的 cases 替换生成阶段产物
继续推进设备调度和执行阶段
```

当前代码状态：

```text
尚未实现。
当前 query/stepwise 是一次性从 START 跑到 SUCCESS。
```

### 3.4 用户指令注入

文档位置：`用户指令注入（上层PlannerAgentAPI）`

建议路径：

```text
POST /api/payload
```

请求体：

```json
{
  "user_id": "u001",
  "task_id": "task-postman-001",
  "user_instruction": "帮我解释当前任务执行到哪里了"
}
```

响应是流式片段：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "task-postman-001",
    "chunk": "当前任务已经完成...",
    "finished": false,
    "message_id": "msg-xxx"
  }
}
```

当前代码状态：

```text
主 Agent 已实现 POST /tasks/chat/stream
尚未实现 /api/payload 别名
```

## 4. 主 Agent 主动调用接口

这些接口是“主 Agent -> 智能体代理服务”。如果最终数据要进入后端云服务，由智能体代理服务继续处理。

### 4.1 上报测试计划详情

文档路径：

```text
POST /api/plan-task-submit
```

或后端任务管理模块中的：

```text
POST /api/test-plans/report-detail
```

文档存在命名不一致。主 Agent 专用文档里建议把二者分工理解为：

```text
/api/plan-task-submit:
  主 Agent / Planner 上报生成后的计划详情或任务计划给代理服务

/api/test-plans/report-detail:
  后端云服务侧接口，主 Agent 不应直接调用；由代理服务转发或落库
```

当前代码状态：

```text
尚未接生成计划阶段，所以暂未使用。
```

### 4.2 上报任务阶段状态

文档路径：

```text
POST /api/tasks/update
```

调用时机：

```text
任务执行中，主 Agent 每个阶段开始、结束、失败时上报。
```

文档字段：

```json
{
  "task_id": "task-postman-001",
  "agent_name": "CASE_EXECUTION_AGENT",
  "task_status": "RUNNING",
  "total_tokens": 0,
  "output_json": "{}",
  "step_log": "执行 Agent 开始执行",
  "start_time": "2026-05-27T10:00:00Z",
  "end_time": "2026-05-27T10:01:00Z"
}
```

当前代码状态：

```text
当前 report_task_update 工具已有上报能力。
当前 mock 后端已支持 POST /api/tasks/update。
当前代码的 TaskUpdate 结构比文档更偏内部增量事件：
  event_id
  task_id
  task_status
  current_stage
  message
  stage_operations
  case_node_operations
  case_detail_operations
```

Postman 实验阶段建议：

```text
先允许 mock 后端同时接收当前 TaskUpdate 和文档 UpdateTaskStatusRequest。
后续再做字段规范化。
```

### 4.3 上传报告或产物文件

文档路径：

```text
POST /api/files/agent/upload
```

请求类型：

```text
multipart/form-data
```

字段：

```text
file_name
file
```

当前代码状态：

```text
mock 后端已支持 /api/files/agent/upload。
当前主 Agent 的主要链路还没有强制上传文件，返回的是本地 artifact path。
Postman 真实实验可先不要求上传，后续再把 analysis/report.md 上传为 file_key。
```

### 4.4 上报计划最终结果

文档位置：`计划结果上报（Proxy Api）`

建议路径：

```text
POST /api/plan-result
```

文档没有明确 path，只有结构。

当前代码状态：

```text
尚未实现计划级最终结果上报。
当前只做任务级 SUCCESS/FAILED。
```

## 5. 主 Agent 与子 Agent 的接口

这些是 CLI，不是 HTTP。

### 5.1 用例生成 Agent

文档命令：

```bash
cat request.json | cli_test_plan_agent
```

输入核心：

```text
markdown
tech_test
channel
type_type
llm_config
embedding_config
dedup_config
case_generate_config
```

输出：

```text
测试用例树 JSON
JSON 日志：agent_started / case_generation_summary / artifact_created / agent_finished / agent_failed
```

当前代码状态：

```text
暂未接真实 cli_test_plan_agent。
query/stepwise 当前使用 mock case generation subagent。
available 当前跳过用例生成，写静态用例。
```

### 5.2 设备调度 Agent

文档命令：

```bash
python -m device_agent bind --task-id roger --case-count 10
```

输出：

```text
device_task_bind_path
bind_devices
case_bindings
```

当前代码状态：

```text
query/stepwise 当前使用 mock device scheduler。
available 当前由主 Agent 写 device_case_bind.json。
```

### 5.3 测试执行 Agent

文档命令：

```bash
python run_API.py execute \
  --user-id u001 \
  --project-id xh \
  --task-id roger \
  --device-case-bind @./device_case_bind.sample.json \
  --used-model glm-4.7 \
  --enable-multimodal-assertion false \
  --enable-multimodal-attribution false
```

当前本机真实仓库实际入口：

```bash
python run_API.py \
  --case <test_cases.md> \
  --json <case_result.json>
```

当前代码状态：

```text
available 模式已通过 adapter 兼容真实 gui-tester 当前入口。
query/stepwise 仍使用 mock execution subagent。
```

### 5.4 结果分析 / 报告 Agent

文档结构：

```text
customer
test_type
log_file
doc
output
project_id
max_concurrent
singel
```

当前代码状态：

```text
available 模式已通过 adapter 调用 inftest-report-agent/run_report.py。
query/stepwise 仍使用 mock result analyzer。
```

## 6. Postman 真实 HTTP 实验建议

### 6.1 实验目标

第一阶段目标不是直接接所有真实子 Agent，而是先验证：

```text
Postman
  -> mock 后端端口
  -> 主 Agent API
  -> query/stepwise 主 Agent 编排
  -> mock 子 Agent
  -> mock 后端收到 update
  -> Postman 查询任务详情
```

这样验证的是：

- HTTP 入口真实。
- 代理服务角色真实。
- 主 Agent 模型编排真实。
- 状态回传真实。
- 产物路径真实。

第二阶段再把 `query/stepwise` 里的子 Agent 从 mock 换成真实 CLI adapter。

### 6.2 Postman 环境变量

```text
base_url = http://127.0.0.1:8790
task_id = task-postman-001
```

### 6.3 启动服务

终端 1：启动主 Agent。

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

### 6.4 Postman 请求 1：启动任务

当前已实现路径：

```text
POST {{base_url}}/api/tasks/alter
```

目标文档路径，建议下一步补别名：

```text
POST {{base_url}}/api/task-manage
```

Body：

```json
{
  "task_id": "{{task_id}}",
  "task_operation": "START",
  "task_target": "用户通过 Postman 发起真实 HTTP 任务：请生成测试计划、调用子 Agent、上报状态并产出报告。"
}
```

预期：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "task-postman-001",
    "task_status": "SUCCESS",
    "agent_response": {
      "data": {
        "runner": "query",
        "orchestration": "stepwise",
        "run_fake_e2e_invoked": false,
        "artifacts": {}
      }
    }
  }
}
```

实际 artifacts 应包含：

```text
plan
test_cases
device_bindings
execution_summary
analysis_report_json
analysis_report
```

### 6.5 Postman 请求 2：查询任务详情

当前已实现：

```text
GET {{base_url}}/api/tasks/detail?task_id={{task_id}}
```

调试用：

```text
GET {{base_url}}/api/mock/tasks/{{task_id}}
```

预期：

```text
task_status = SUCCESS
updates 数量大于 0
task_log 包含主 Agent 最终回复
report_file_key 指向 analysis/report.md
```

### 6.6 Postman 请求 3：暂停 / 继续

暂停：

```text
POST {{base_url}}/api/tasks/alter
```

```json
{
  "task_id": "{{task_id}}",
  "task_operation": "PAUSE"
}
```

继续：

```json
{
  "task_id": "{{task_id}}",
  "task_operation": "CONTINUE"
}
```

说明：

```text
当前 START 是同步长请求，任务完成很快时，PAUSE/CONTINUE 只能验证接口转发和状态变更。
要验证真正运行中暂停，需要后续把 START 改为异步任务或制造长耗时子 Agent。
```

### 6.7 Postman 请求 4：终止

当前 mock 后端已支持：

```text
POST {{base_url}}/api/tasks/alter
```

```json
{
  "task_id": "{{task_id}}",
  "task_operation": "TERMINATION"
}
```

它会转发到主 Agent：

```text
POST /tasks/terminate
```

## 7. 当前差距清单

为严格贴合 `InfTest 接口文档 (1).md`，建议下一步补齐：

```text
1. mock 后端增加 /api/task-manage，兼容 /api/tasks/alter。
2. mock 后端增加 /api/payload，转发到主 Agent /tasks/chat/stream。
3. mock 后端增加 /api/case-publish，先保存用户审核后的用例，后续再驱动主 Agent 继续执行。
4. 主 Agent 或 mock 后端补 /api/generate-plan 实验入口。
5. report_task_update 输出增加文档字段映射：
   agent_name
   task_status
   total_tokens
   output_json
   step_log
   start_time
   end_time
6. query/stepwise 的 invoke_subagent 从 mock 子 Agent 切到真实 CLI adapter。
7. 报告完成后调用 /api/files/agent/upload，返回 report_file_key，而不仅是本地文件路径。
```

## 8. 当前判断

按照文档和领导口径，主 Agent 的 HTTP 直接交互对象只有：

```text
智能体代理服务：
  调用主 Agent 的 HTTP API。
  接收主 Agent 的任务状态、计划详情、报告文件上报。
```

主 Agent 不直接交互的对象：

```text
前端 Web Client：
  前端只调用后端云服务。

后端云服务：
  后端云服务只和智能体代理服务通信，不直接调用主 Agent。

设备云服务 / 设备终端：
  执行 Agent 通过 /api/cmd-bridge/submit 操作设备，主 Agent 不直接操作设备。
```

主 Agent 还会通过 CLI 调用子 Agent，但这不是 HTTP 服务交互。

Postman 实验应该模拟的是：

```text
Postman 扮演前端/后端发起者
mock 后端对主 Agent 扮演智能体代理服务
主 Agent 扮演 Planner Agent
mock 或真实 CLI 子 Agent 扮演业务执行者
```
