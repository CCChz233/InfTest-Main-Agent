# InfTest API 全真模拟联调经验手册

> 日期：2026-05-26  
> 目标：沉淀本机完成 `HTTP API -> InfTest 主 Agent -> AvailableAgentsRunner -> 执行 Agent 产物 -> 报告 Agent CLI -> SUCCESS` 的经验。  
> 当前状态：执行 Agent 因本机无设备使用 mock 产物，报告 Agent 仍通过真实 CLI 调用，模型服务用本地 OpenAI 兼容 stub。

## 0. 2026-05-27 端口模拟补充结论

如果目标是“带 mock 后端端口，真正模拟用户从平台发起任务”，优先使用：

```bash
INFTEST_RUNNER=query
INFTEST_ORCHESTRATION=stepwise
```

原因：

- `available` 适合验证真实 CLI adapter 接线，流程是确定性 runner。
- `query + stepwise` 会进入主 Agent 模型编排，由模型调用 InfTest tools，更接近真实用户输入后的主 Agent 行为。
- mock 后端端口负责模拟平台侧 API，包括 `POST /api/tasks/alter`、`GET /api/tasks/detail`、`POST /api/tasks/update`。

已新增并验证：

```text
scripts/inftest_mock_backend_api.ts
scripts/inftest_mock_backend_query_e2e.ts
inftest_docs/InfTest_Mock后端端口Query模式联调手册.md
```

已验证命令：

```bash
bun run scripts/inftest_mock_backend_query_e2e.ts \
  --task-id task-port-query-003 \
  --agent-port 18887 \
  --backend-port 18890
```

结果：

```text
mode = mock-backend + query + stepwise
runner = query
orchestration = stepwise
task_status = SUCCESS
run_fake_e2e_invoked = false
```

注意：这条链路验证的是端口、用户输入、主 Agent 模型编排和工具闭环；它不调用真实 `gui-tester` 和真实 `inftest-report-agent`。真实 CLI 子 Agent 接线仍看 `available` 模式。

## 1. 联调边界

本轮验证不是 fake E2E，也不是 UI 联调。

真实链路如下：

```text
HTTP API
POST /tasks/alter START
  -> InfTest-Main-Agent
  -> AvailableAgentsRunner
  -> 生成静态测试计划 plan.json
  -> 写 device_case_bind.json
  -> 调用执行 Agent adapter
  -> 生成或读取 case_result.json / summary.json
  -> CLI 调 inftest-report-agent/run_report.py
  -> 生成 analysis/report.md
  -> 返回 task_status=SUCCESS
```

本轮明确没有做的事：

- 没有接 `cli_test_plan_agent`。
- 没有接 UI。
- 没有删除 fake E2E。
- 没有改 QueryEngine 主循环。
- 没有把 `gui-tester` 或 `inftest-report-agent` 代码合并进主 Agent。

## 2. 本机关键路径

本机仓库布局：

```text
/Users/chz/workspace/inftest-runtime/
├── cli_test_plan_agent
├── gui-tester
├── InfTest-Main-Agent
├── inftest-report-agent
└── docs
```

本轮实际确认的入口：

```text
执行 Agent 仓库：
/Users/chz/workspace/inftest-runtime/gui-tester

当前执行入口：
/Users/chz/workspace/inftest-runtime/gui-tester/run_API.py

报告 Agent 仓库：
/Users/chz/workspace/inftest-runtime/inftest-report-agent

当前报告入口：
/Users/chz/workspace/inftest-runtime/inftest-report-agent/run_report.py

需求文档：
/Users/chz/workspace/inftest-runtime/docs/Kongming（孔明）—— AI 原生质量OS (1).docx
```

Python 运行环境：

```text
/Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.venv-inftest-py313
```

原因：系统 `python3` 是 3.14，部分 `gui-tester` 依赖不兼容 3.14；本轮使用 Python 3.13 虚拟环境安装 `gui-tester` 和 `inftest-report-agent` 的依赖。

## 3. 主 Agent 侧接线经验

### 3.1 API runner 模式

`INFTEST_RUNNER=available` 必须由 HTTP API 识别，并转到 `runInfTestAvailableAgentsE2E`。

涉及主仓文件：

```text
src/inftest/schemas/session.ts
src/inftest/schemas/config.ts
src/inftest/TaskSessionManager.ts
src/inftest/server/taskApi.ts
```

经验：

- `fake` 和 `query` 不应该被破坏。
- `available` 是第三种 runner，不是 fake 的别名。
- API 成功响应里要能看见：

```json
{
  "runner": "available",
  "task_status": "SUCCESS"
}
```

### 3.2 AvailableAgentsRunner 不应该直接关心真实子仓实现

`AvailableAgentsRunner` 只负责：

- 初始化 workspace
- 写静态 plan
- 写 `device_case_bind.json`
- 通过 `SubAgentAdapter` 调用配置里的 CLI adapter
- 等待执行结果
- 调用报告 Agent
- 汇总产物并上报状态

真实执行 Agent 和报告 Agent 的差异放在 adapter 里处理。

## 4. 执行 Agent 经验

### 4.1 文档命令和当前代码不一致

旧文档描述的执行命令类似：

```bash
python run_API.py execute --device-case-bind ...
```

但当前 `gui-tester/run_API.py` 实际支持的主要参数是：

```bash
python run_API.py \
  --case <test_cases.md> \
  --json <case_result.json>
```

它内部调用 `front/api_server.py` 的：

```text
POST /api/run-testcase-file
```

因此主 Agent 的执行 adapter 需要把 `device_case_bind.json` 转成临时 Markdown 用例文件：

```text
.inftest-workspace/<task_id>/execution/inputs/test_cases.md
```

然后调用：

```bash
python run_API.py \
  --case <workspace>/execution/inputs/test_cases.md \
  --json <workspace>/execution/results/case_result.json
```

### 4.2 真实设备阻塞

单独跑真实执行 Agent 时，当前本机返回：

```json
{"success":false,"error":"未检测到可用测试设备，请先连接设备"}
```

相关日志里还能看到：

```text
Error listing devices: [Errno 2] No such file or directory: 'hdc'
Error: idevice_id not found. Install libimobiledevice: brew install libimobiledevice
```

结论：

- 主 Agent 到执行 Agent CLI 的链路是通的。
- 没有设备时，真实 `gui-tester` 不会生成 `case_result.json`。
- 因此本机无法用真设备完成执行阶段。

### 4.3 执行 Agent mock 产物开关

为绕过本机无设备问题，执行 adapter 支持 mock 模式：

```bash
export INFTEST_EXECUTION_AGENT_MODE=mock
```

或：

```bash
export INFTEST_EXECUTION_MOCK=true
```

该模式仍然走：

```text
AvailableAgentsRunner
  -> SubAgentAdapter
  -> scripts/inftest_real_execution_agent_adapter.py
```

但 adapter 不调用 `gui-tester/run_API.py`，而是根据 `device_case_bind.json` 直接生成：

```text
execution/results/case_result.json
execution/results/summary.json
execution/logs/real_execution_agent_invocation.json
execution/logs/real_execution_agent.stdout.log
execution/logs/real_execution_agent.stderr.log
execution/result.json
```

注意：

- 这只 mock 执行结果。
- 不会切回 fake E2E。
- 不会跳过报告 Agent。
- 去掉 `INFTEST_EXECUTION_AGENT_MODE=mock` 后，会重新走真实执行 Agent。

## 5. 报告 Agent 经验

### 5.1 报告 Agent 是真实 CLI

主 Agent 通过：

```text
scripts/inftest_real_report_agent_adapter.py
```

调用：

```bash
python run_report.py \
  --customer 新华 \
  --project-id xh \
  --log-file <workspace>/execution/results/case_result.json \
  --doc <requirement.docx> \
  --output <workspace>/analysis/report_agent_output
```

成功后 adapter 会把报告统一复制到：

```text
<workspace>/analysis/report.md
```

同时保留报告 Agent 原始输出：

```text
<workspace>/analysis/report_agent_output/总报告/
```

### 5.2 case_result 兼容点

报告 Agent 文档里的输入可以包含顶层 `functional` 字段。

本轮遇到的问题：

```text
用例缺少预归因数据
```

原因：报告 Agent 原代码只识别 `attribution` 或 `reason` 作为预归因。

处理经验：

- 在 `inftest-report-agent/services/log_parsing.py` 里兼容顶层 `functional`。
- 这样 mock 的 `case_result.json` 可以直接被报告 Agent 解析。

### 5.3 模型服务阻塞

报告 Agent 会读取 `inftest-report-agent/.env`：

```env
BASE_URL=http://127.0.0.1:8000/v1
MODEL=autoglm-phone-9b
API_KEY=EMPTY
```

如果本机没有模型服务，会失败：

```text
错误: 模型调用失败：Connection error.
```

### 5.4 本地模型 stub

为完成本机闭环，主仓新增了：

```text
scripts/inftest_mock_openai_server.py
```

作用：提供最小 OpenAI 兼容接口：

```text
GET  /v1/models
POST /v1/chat/completions
```

启动方式：

```bash
cd /Users/chz/workspace/inftest-runtime/InfTest-Main-Agent
.venv-inftest-py313/bin/python scripts/inftest_mock_openai_server.py --host 127.0.0.1 --port 8000
```

注意：

- 这是本机联调用 stub，不是生产方案。
- 报告 Agent 仍然是真实 CLI。
- 报告内容由 stub 返回固定 Markdown，只用于验证链路和产物落盘。

## 6. 本机成功复现命令

### 6.1 进入主仓

```bash
cd /Users/chz/workspace/inftest-runtime/InfTest-Main-Agent
```

### 6.2 启动模型 stub

单独开一个终端：

```bash
.venv-inftest-py313/bin/python scripts/inftest_mock_openai_server.py --host 127.0.0.1 --port 8000
```

### 6.3 跑 CLI E2E

```bash
INFTEST_EXECUTION_AGENT_MODE=mock \
INFTEST_CONFIG=.inftest/config.available-agents.example.json \
INFTEST_REPORT_AGENT_CWD=/Users/chz/workspace/inftest-runtime/inftest-report-agent \
INFTEST_REPORT_AGENT_PYTHON=/Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.venv-inftest-py313/bin/python \
INFTEST_REQUIREMENT_DOC='/Users/chz/workspace/inftest-runtime/docs/Kongming（孔明）—— AI 原生质量OS (1).docx' \
/Users/chz/.bun/bin/bun run scripts/inftest_available_agents_e2e.ts \
  --task-id task-local-exec-mock-003 \
  --timeout-seconds 900
```

成功结果：

```json
{
  "task_id": "task-local-exec-mock-003",
  "status": "SUCCESS",
  "summary_found": true,
  "error": null
}
```

### 6.4 启动 HTTP API

单独开一个终端：

```bash
INFTEST_RUNNER=available \
INFTEST_EXECUTION_AGENT_MODE=mock \
INFTEST_CONFIG=.inftest/config.available-agents.example.json \
INFTEST_REPORT_AGENT_CWD=/Users/chz/workspace/inftest-runtime/inftest-report-agent \
INFTEST_REPORT_AGENT_PYTHON=/Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.venv-inftest-py313/bin/python \
INFTEST_REQUIREMENT_DOC='/Users/chz/workspace/inftest-runtime/docs/Kongming（孔明）—— AI 原生质量OS (1).docx' \
/Users/chz/.bun/bin/bun run scripts/inftest_task_api.ts
```

期望监听：

```text
InfTest task API listening on http://127.0.0.1:8787
```

### 6.5 调用 START

```bash
curl -sS -X POST http://127.0.0.1:8787/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-api-real-001","task_operation":"START"}'
```

成功响应关键字段：

```json
{
  "code": 0,
  "data": {
    "task_id": "task-api-real-001",
    "task_status": "SUCCESS",
    "runner": "available"
  }
}
```

### 6.6 查询任务状态

```bash
curl -sS http://127.0.0.1:8787/tasks/task-api-real-001
```

成功响应关键字段：

```json
{
  "code": 0,
  "data": {
    "task_detail": {
      "task_status": "SUCCESS",
      "runner": "available",
      "last_error": null
    }
  }
}
```

## 7. 成功产物

本轮 API 成功任务：

```text
task-api-real-001
```

关键产物：

```text
.inftest-workspace/task-api-real-001/plan.json
.inftest-workspace/task-api-real-001/device_scheduling/device_case_bind.json
.inftest-workspace/task-api-real-001/execution/results/case_result.json
.inftest-workspace/task-api-real-001/execution/results/summary.json
.inftest-workspace/task-api-real-001/analysis/report.md
```

报告 Agent 原始产物：

```text
.inftest-workspace/task-api-real-001/analysis/report_agent_output/总报告/整合测试报告_新华_xh.md
.inftest-workspace/task-api-real-001/analysis/report_agent_output/总报告/整合测试报告_新华_xh.docx
.inftest-workspace/task-api-real-001/analysis/report_agent_output/总报告/缺陷统计明细_整合_新华_xh.json
```

执行 mock 的 `summary.json` 示例：

```json
{
  "task_id": "task-api-real-001",
  "total": 1,
  "passed": 1,
  "failed": 0,
  "skipped": 0,
  "status": "SUCCESS",
  "case_results": [
    "task-api-real-001_case_000"
  ]
}
```

## 8. 关键日志

执行 Agent：

```text
.inftest-workspace/<task_id>/execution/logs/real_execution_agent_invocation.json
.inftest-workspace/<task_id>/execution/logs/real_execution_agent.stdout.log
.inftest-workspace/<task_id>/execution/logs/real_execution_agent.stderr.log
.inftest-workspace/<task_id>/execution/result.json
```

报告 Agent：

```text
.inftest-workspace/<task_id>/analysis/logs/real_report_agent_invocation.json
.inftest-workspace/<task_id>/analysis/logs/real_report_agent.stdout.log
.inftest-workspace/<task_id>/analysis/logs/real_report_agent.stderr.log
.inftest-workspace/<task_id>/analysis/result.json
```

判断失败点的顺序：

1. 先看 API 响应里的 `data.steps`。
2. 如果失败在 `invoke_subagent:test_executor`，看 `execution/result.json` 和执行日志。
3. 如果失败在 `invoke_subagent:result_analyzer`，看 `analysis/result.json` 和报告日志。
4. 如果 `summary_found=false`，检查 `execution/results/summary.json` 是否存在且格式正确。
5. 如果 `analysis/report.md` 不存在，检查报告 Agent 是否生成了 Markdown 原始产物。

## 9. 常见问题

### 9.1 API 启动失败：缺少 `@opentelemetry/api`

现象：

```text
Cannot find module '@opentelemetry/api'
```

处理：

```bash
/Users/chz/.bun/bin/bun install
```

### 9.2 `bun` 不在 PATH

本机 Codex shell 里 `PATH` 可能没有 `/Users/chz/.bun/bin`。

处理：

```bash
/Users/chz/.bun/bin/bun run ...
```

### 9.3 本地端口访问失败

现象：

```text
curl: Failed to connect to 127.0.0.1 port 8787
```

在 Codex 沙箱里，启动或访问本地端口可能需要提升权限。普通本机终端通常不需要。

### 9.4 执行 Agent 不生成 `case_result.json`

先看：

```text
execution/logs/real_execution_agent.stdout.log
execution/logs/real_execution_agent.stderr.log
execution/result.json
```

如果看到：

```text
未检测到可用测试设备
```

说明不是主 Agent 接线问题，而是真实设备环境问题。

### 9.5 报告 Agent `Connection error`

先确认：

```text
inftest-report-agent/.env
BASE_URL=http://127.0.0.1:8000/v1
```

如果没有真实模型服务，先启动本地 stub：

```bash
.venv-inftest-py313/bin/python scripts/inftest_mock_openai_server.py --host 127.0.0.1 --port 8000
```

### 9.6 报告 Agent 说缺少预归因

检查 `case_result.json` 中是否包含：

```json
{
  "functional": {
    "status": "passed",
    "test_type": "functional"
  }
}
```

以及报告 Agent 是否已经兼容顶层 `functional`。

## 10. 从 mock 切回真执行

切回真实执行 Agent 时：

1. 不设置 `INFTEST_EXECUTION_AGENT_MODE=mock`。
2. 启动 `gui-tester/front/api_server.py`。
3. 如果端口不是默认 5000，需要设置 `API_PORT`。
4. 确保设备可用：
   - Android：`adb devices`
   - Harmony：`hdc list targets`
   - iOS：`idevice_id -l`
5. 重新跑 CLI E2E 或 API START。

真实执行模式推荐环境变量：

```bash
export INFTEST_EXECUTION_AGENT_CWD=/Users/chz/workspace/inftest-runtime/gui-tester
export INFTEST_EXECUTION_AGENT_PYTHON=/Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.venv-inftest-py313/bin/python
export INFTEST_EXECUTION_AGENT_MODE=file_api
export API_PORT=5001
```

如果 `gui-tester` 能成功写出：

```text
execution/results/case_result.json
```

就可以去掉执行 mock，后续报告阶段无需改主 Agent。

## 10.1 只模拟设备层的推荐方式

当暂时没有真实手机，但希望其他链路尽量真实时，不要使用：

```bash
export INFTEST_EXECUTION_AGENT_MODE=mock
```

因为这个开关会绕过 `gui-tester/run_API.py`。

推荐使用 `gui-tester` 的设备层 mock：

```bash
cd /Users/chz/workspace/inftest-runtime/gui-tester

API_PORT=5002 \
INFTEST_MOCK_DEVICE=1 \
/Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.venv-inftest-py313/bin/python \
front/api_server.py
```

然后主 Agent 仍按真实执行 Agent 调用：

```bash
cd /Users/chz/workspace/inftest-runtime/InfTest-Main-Agent

INFTEST_RUNNER=available \
INFTEST_CONFIG=.inftest/config.available-agents.example.json \
INFTEST_PORT=8792 \
API_PORT=5002 \
INFTEST_EXECUTION_AGENT_CWD=/Users/chz/workspace/inftest-runtime/gui-tester \
INFTEST_EXECUTION_AGENT_PYTHON=/Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.venv-inftest-py313/bin/python \
INFTEST_REPORT_AGENT_CWD=/Users/chz/workspace/inftest-runtime/inftest-report-agent \
INFTEST_REPORT_AGENT_PYTHON=/Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.venv-inftest-py313/bin/python \
INFTEST_REQUIREMENT_DOC='/Users/chz/workspace/inftest-runtime/docs/Kongming（孔明）—— AI 原生质量OS (1).docx' \
bun run scripts/inftest_task_api.ts
```

Postman 或 curl 调用：

```bash
curl -sS -X POST http://127.0.0.1:8792/tasks/alter \
  -H 'Content-Type: application/json' \
  -d '{"task_id":"task-api-device-mock-002","task_operation":"START"}'
```

这条链路中只有设备被模拟：

```text
HTTP API 真实
InfTest 主 Agent 真实
AvailableAgentsRunner 真实
SubAgentAdapter 真实
gui-tester/run_API.py 真实
gui-tester/front/api_server.py 真实
设备发现和单用例执行结果 mock
inftest-report-agent/run_report.py 真实
```

已验证设备 mock 后可以生成：

```text
.inftest-workspace/task-api-device-mock-002/execution/results/case_result.json
.inftest-workspace/task-api-device-mock-002/execution/results/summary.json
```

当前如果不启用模型 stub、不接真实模型服务，链路会继续真实卡在报告 Agent：

```text
result_analyzer failed: Report agent exited with code 1. 错误: 模型调用失败：Connection error.
```

## 11. 验收口径

### 11.1 本机全真模拟成功口径

允许：

- 执行 Agent 产物 mock。
- 模型服务 stub。

必须真实：

- HTTP API。
- InfTest 主 Agent。
- `AvailableAgentsRunner`。
- `SubAgentAdapter`。
- 报告 Agent CLI。
- workspace 产物写入。

成功标准：

```text
POST /tasks/alter START 返回：
runner=available
task_status=SUCCESS

产物存在：
plan.json
device_case_bind.json
case_result.json
summary.json
analysis/report.md
```

### 11.2 真设备真模型成功口径

不允许：

- `INFTEST_EXECUTION_AGENT_MODE=mock`
- `scripts/inftest_mock_openai_server.py`

必须：

- 真实设备在线。
- `gui-tester` 真实执行并写出 `case_result.json`。
- 真实模型服务可访问。
- 报告 Agent 用真实模型生成报告。

## 12. 本轮实际结论

本轮已经证明：

- `INFTEST_RUNNER=available` 的 HTTP 入口可以启动主 Agent。
- 主 Agent 可以生成静态计划和设备用例绑定。
- 子 Agent 仍保持独立仓库，通过 CLI 适配。
- 执行阶段可以用标准 `case_result.json/summary.json` 产物解耦设备阻塞。
- 报告 Agent 可以基于该标准产物生成 `analysis/report.md`。
- API 最终可返回 `runner=available` 和 `task_status=SUCCESS`。

剩余真实环境事项：

- 接入可用测试设备，去掉执行 mock。
- 接入真实 LLM 服务，去掉模型 stub。
- 在服务器环境复跑同样命令，确认端口、设备、模型、Python 依赖都稳定。
