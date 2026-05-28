# InfTest Postman 智能体代理服务模拟测试用例

> 日期：2026-05-27  
> 目标：只用 Postman 模拟“智能体代理服务 Agent Service 直接调用 InfTest 主 Agent”，验证主 Agent 的真实 HTTP 启动、任务详情获取、状态回调和产物返回链路。

## 1. 实验口径

领导确认口径：

```text
主 Agent 的 HTTP 直接交互对象只有智能体代理服务 Agent Service。
```

因此本 Postman 实验只做一种方式：

```text
Postman 直接扮演智能体代理服务
Postman -> InfTest 主 Agent
InfTest 主 Agent -> mock Agent Service 获取 task detail
InfTest 主 Agent -> mock Agent Service 上报 task update
```

`mock Agent Service` 是本机临时模拟的智能体代理服务，不是生产系统，也不是子 Agent。它只用于补齐 Postman 做不到的服务端能力：

```text
1. 给主 Agent 提供 task detail。
2. 接收主 Agent 的 /api/tasks/update 状态回调。
3. 提供 debug 查询，方便确认主 Agent 是否真的回调了智能体代理服务。
```

本实验不包含任何由 mock Agent Service 代发 START 的请求。原因是这种请求多测了一层 mock 服务转发能力，不是主 Agent 与智能体代理服务的直接接口合同。

## 2. 服务准备

### 2.1 启动 mock Agent Service

先启动 mock Agent Service，因为主 Agent 启动任务后要向它取任务详情、上报状态。

```bash
INFTEST_AGENT_BASE_URL=http://127.0.0.1:8787 \
INFTEST_MOCK_BACKEND_PORT=8790 \
bun run scripts/inftest_mock_backend_api.ts
```

mock Agent Service 地址：

```text
http://127.0.0.1:8790
```

### 2.2 启动主 Agent

在 `InfTest-Main-Agent` 目录启动：

```bash
INFTEST_RUNNER=query \
INFTEST_ORCHESTRATION=stepwise \
INFTEST_PROXY_BASE_URL=http://127.0.0.1:8790 \
INFTEST_PROXY_TASK_REPORT_PATH=api/tasks/update \
bun run scripts/inftest_task_api.ts
```

主 Agent 地址：

```text
http://127.0.0.1:8787
```

## 3. Postman 环境变量

建议创建一个 Postman Environment：

| 变量 | 值 |
| --- | --- |
| `main_agent_base_url` | `http://127.0.0.1:8787` |
| `proxy_base_url` | `http://127.0.0.1:8790` |
| `task_id` | `task-postman-direct-001` |

已提供可导入的 collection：

```text
postman/InfTest_MainAgent_ProxySimulation.postman_collection.json
```

## 4. 测试用例

### TC-00 健康检查

目的：确认主 Agent 和 mock Agent Service 都已启动。

请求 1：

```text
GET {{main_agent_base_url}}/health
```

预期：

```json
{
  "code": 0,
  "data": {
    "status": "ok"
  }
}
```

请求 2：

```text
GET {{proxy_base_url}}/health
```

预期：

```json
{
  "code": 0,
  "data": {
    "status": "ok",
    "service": "inftest-mock-backend"
  }
}
```

### TC-01 START：智能体代理服务启动主 Agent 任务

目的：验证“智能体代理服务 -> 主 Agent”的直接 HTTP 启动接口。

请求：

```text
POST {{main_agent_base_url}}/tasks/alter
```

Body：

```json
{
  "task_id": "{{task_id}}",
  "task_operation": "START"
}
```

主 Agent 执行中会自动：

```text
GET  {{proxy_base_url}}/tasks/{{task_id}}
POST {{proxy_base_url}}/api/tasks/update
```

预期：

```text
code = 0
data.task_status = SUCCESS
data.runner = query
data.orchestration = stepwise
data.run_fake_e2e_invoked = false
data.artifacts.plan 存在
data.artifacts.test_cases 存在
data.artifacts.execution_summary 存在
data.artifacts.analysis_report 存在
```

### TC-02 查询主 Agent 侧任务详情

目的：确认主 Agent 本地 session 记录了任务状态和产物。

请求：

```text
GET {{main_agent_base_url}}/tasks/{{task_id}}
```

预期：

```text
code = 0
data.task_detail.task_status = SUCCESS
data.task_detail.runner = query
data.task_detail.artifacts.plan 存在
data.task_detail.artifacts.execution_summary 存在
data.task_detail.artifacts.analysis_report 存在
```

### TC-03 查询 mock Agent Service 回调记录

目的：确认主 Agent 在执行过程中确实回调了智能体代理服务。

请求：

```text
GET {{proxy_base_url}}/api/mock/tasks/{{task_id}}
```

预期：

```text
code = 0
data.task_id = {{task_id}}
data.updates.length > 0
data.task_log 非空
```

说明：

```text
这里查询的是 mock Agent Service 的 debug 记录。
真实环境中，这些 update 会由智能体代理服务落库或转发到后端云服务。
```

### TC-04 用户指令注入冒烟

目的：验证智能体代理服务能向主 Agent 注入用户指令，并获取任务状态回答。

当前主 Agent 已实现路径：

```text
POST {{main_agent_base_url}}/tasks/chat/stream
```

Body：

```json
{
  "user_id": "u001",
  "task_id": "{{task_id}}",
  "user_instruction": "请总结当前任务执行状态和报告路径"
}
```

预期：

```text
返回 SSE/流式片段。
内容能说明任务状态、runner、artifacts 或报告路径。
```

后续如果严格贴合接口文档，可以再给主 Agent 或代理层补：

```text
POST /api/payload
```

### TC-05 终止接口冒烟

目的：验证智能体代理服务能直接向主 Agent 发终止请求。

请求：

```text
POST {{main_agent_base_url}}/tasks/terminate
```

Body：

```json
{
  "task_id": "{{task_id}}"
}
```

预期：

```text
code = 0
message = Task terminated
```

注意：

```text
当前 START 是同步长请求，Postman 通常只能在任务已经 SUCCESS 后再发 TERMINATE。
这条用例只验证接口可用，不验证运行中强杀。
真正运行中暂停/继续/终止，需要后续把 START 改为异步任务，或制造长耗时子 Agent。
```

## 5. 当前实验覆盖度

当前 Postman 实验能覆盖：

```text
智能体代理服务直接启动主 Agent
主 Agent 获取 task detail
主 Agent 执行 query/stepwise 编排
主 Agent 调子 Agent
主 Agent 回调任务状态
智能体代理服务接收 update
Postman 查询主 Agent 状态
Postman 查询代理服务回调记录
```

当前还不能完全覆盖：

```text
/api/generate-plan 生成计划入口
/api/case-publish 用户审核后用例下发
/api/payload 文档别名
真实 cli_test_plan_agent
query/stepwise 中调用真实 gui-tester / report-agent CLI
报告上传后返回 MinIO file_key
运行中暂停/继续/终止
```

## 6. 下一步建议

为了让 Postman 实验更贴近 `InfTest 接口文档 (1).md`，建议按这个顺序补：

```text
1. 主 Agent 或代理层补 /api/payload。
2. 主 Agent 或代理层补 /api/case-publish。
3. 主 Agent 或代理层补 /api/generate-plan。
4. 主 Agent START 支持异步模式，便于 Postman 测 PAUSE/CONTINUE/TERMINATION。
5. query/stepwise 的 invoke_subagent 支持切换真实 CLI adapter。
6. 报告产物通过 /api/files/agent/upload 上传并返回 report_file_key。
```
