# InfTest 当前需要对接的接口清单

> 只列当前联调要对的接口。

## 1. 主 Agent 对外接口

对接对象：智能体代理服务 Agent Service

Base URL：

```text
http://<server-ip>:8787
```

### 1.1 健康检查

```text
GET /health
```

用途：确认主 Agent 服务可访问。

### 1.2 Planner API 字段对齐接口

这些接口当前都是 stub，只用于先对字段和连通性。

```text
POST /api/generate-plan
POST /api/plan-task-publish
POST /api/case-publish
POST /api/task-report-generate
POST /api/task-manage
POST /api/user-instruction
POST /api/payload
```

成功标准：

```json
{
  "code": 0,
  "message": "success"
}
```

注意：

```text
/api/task-manage 现在不会真正启动任务。
任务标识字段统一用 exec_id。
```

### 1.3 真实任务启动接口

```text
POST /tasks/alter
```

请求：

```json
{
  "exec_id": "exec-server-001",
  "task_operation": "START"
}
```

用途：真正启动主 Agent stateful 链路。

注意：

```text
真实启动任务用 /tasks/alter，不用 /api/task-manage。
```

### 1.4 任务状态查询接口

```text
GET /tasks/{exec_id}
```

用途：查询任务状态、失败原因、产物路径。

重点看：

```text
runner
task_status
current_stage
last_error
run_fake_e2e_invoked
artifacts
```

### 1.5 任务终止接口

```text
POST /tasks/terminate
```

请求：

```json
{
  "exec_id": "exec-server-001"
}
```

用途：终止主 Agent 当前任务。

## 2. 执行 Agent 对接

对接对象：执行 Agent / gui-tester 负责人

主 Agent 内部调用：

```text
gui-tester/run_API.py
```

命令形态：

```bash
python run_API.py --case <test_cases.md> --json <case_result.json>
```

依赖 gui-tester API：

```text
GET  /api/health
POST /api/run-testcase-file
```

必须对齐：

```text
API_PORT
INFTEST_EXECUTION_AGENT_CWD
INFTEST_EXECUTION_AGENT_PYTHON
是否有真实设备
是否允许 INFTEST_MOCK_DEVICE=1
```

注意：

```text
不要使用 INFTEST_EXECUTION_AGENT_MODE=mock。
没有真设备时，只能在 gui-tester 层使用 INFTEST_MOCK_DEVICE=1。
```

## 3. 报告 Agent 对接

对接对象：报告 Agent 负责人

主 Agent 内部调用：

```text
inftest-report-agent/run_report.py
```

命令形态：

```bash
python run_report.py \
  --customer 新华 \
  --project-id xh \
  --log-file <case_result.json> \
  --doc <requirements.docx> \
  --output <output_dir>
```

必须对齐：

```text
INFTEST_REPORT_AGENT_CWD
INFTEST_REPORT_AGENT_PYTHON
INFTEST_REQUIREMENT_DOC
```

## 4. 模型服务对接

对接对象：报告 Agent / 模型服务负责人

报告 Agent 依赖 OpenAI-compatible 接口：

```text
GET  /v1/models
POST /v1/chat/completions
```

必须对齐 `inftest-report-agent/.env`：

```text
BASE_URL
MODEL
API_KEY
```

当前最常见失败：

```text
模型调用失败：Connection error.
```

## 5. 最短联调顺序

```text
1. Agent Service -> GET /health
2. Agent Service -> POST /api/generate-plan
3. Agent Service -> POST /api/task-manage
4. 主 Agent 侧检查 .inftest-workspace/planner-api-stub/
5. Agent Service -> POST /tasks/alter START
6. Agent Service -> GET /tasks/{exec_id}
7. 如果执行失败，看 gui-tester / API_PORT / 设备
8. 如果报告失败，看报告 Agent / 模型服务
```

## 6. 一句话结论

```text
先和智能体代理服务对 /api/* 和 /tasks/alter；
再和执行 Agent 对 run_API.py、API_PORT、设备；
最后和报告 Agent / 模型服务对 run_report.py 和 /v1/chat/completions。
```
