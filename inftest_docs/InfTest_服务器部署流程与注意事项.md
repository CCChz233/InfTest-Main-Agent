# InfTest 服务器部署流程与注意事项

> 日期：2026-05-28  
> 目的：给服务器部署和首次联调使用，按当前主 Agent 状态机版本执行。  
> 当前推荐入口：`INFTEST_RUNNER=stateful` + `POST /tasks/alter START`。
> 对外任务标识字段：`exec_id`。

## 1. 当前部署口径

当前主 Agent 可以上传服务器进入联调，但要按下面边界理解：

- 主 Agent 暴露 HTTP 服务给智能体代理服务调用。
- 主 Agent 内部通过 CLI 子进程调用真实子 Agent。
- 执行 Agent 真实入口是 `gui-tester/run_API.py`。
- 报告 Agent 真实入口是 `inftest-report-agent/run_report.py`。
- 当前没有接真实用例生成 Agent，主 Agent 仍使用静态用例。
- 设备调度可通过 `INFTEST_REAL_DEVICE_SCHEDULER=1` 调用 `inftest_execute_agent` 的 `device_agent`（`scripts/inftest_real_device_scheduler_adapter.py`）。
- Planner `/api/*` 已全量 real 化（异步受理为主），不再返回固定 stub 成功。

不要使用：

```bash
INFTEST_EXECUTION_AGENT_MODE=mock
```

如果服务器暂时没有真实设备，只允许在 `gui-tester` 设备层启用：

```bash
INFTEST_MOCK_DEVICE=1
```

这样主 Agent 仍会真实 CLI 调用 `gui-tester/run_API.py`，只是 `gui-tester/front/api_server.py` 内部用 mock 设备结果。

## 2. 服务器目录建议

建议服务器上保持三个仓库独立，不要把子 Agent 代码合并进主 Agent：

```text
/path/to/InfTest-Main-Agent
/path/to/gui-tester
/path/to/inftest-report-agent
/path/to/requirements.docx
```

主 Agent 只通过环境变量知道子 Agent 位置：

```text
INFTEST_EXECUTION_AGENT_CWD=<server gui-tester path>
INFTEST_REPORT_AGENT_CWD=<server report-agent path>
INFTEST_REQUIREMENT_DOC=<server requirement doc path>
INFTEST_DEVICE_AGENT_CWD=<server inftest_execute_agent path>
```

启用真实设备调度（COORDINATE 阶段）：

```bash
export INFTEST_REAL_DEVICE_SCHEDULER=1
export INFTEST_DEVICE_AGENT_CWD=/path/to/inftest_execute_agent
# 必须与执行 Agent 使用同一 Python 环境（含 httpx、async_adbutils）：
export INFTEST_DEVICE_AGENT_PYTHON=/root/miniconda3/envs/inftest_server/bin/python
# 已知设备 ID 时（跳过 discover）：
export INFTEST_DEVICE_ID=SM02G4061977180
export INFTEST_DEVICE_AGENT_DISCOVER=false
# Cloud 探测在线 executor 时：
# export INFTEST_DEVICE_AGENT_CLOUD=1
# export CMD_EXECUTOR_AGENT_URL=http://<proxy-host>:<port>
```

`inftest_execute_agent` 需安装依赖：`pip install -r requirements.txt`（含 `async_adbutils`、`httpx`）。

联调验收：任务 workspace 下应出现 `device_scheduling/result.json` 且 `"source": "real_subagent"`，以及 `schedule_info.json`（含 `device_task_bind`）。

## 3. 部署前检查

进入服务器后先确认基础命令：

```bash
which git
which bun
bun --version
which python
python --version
```

确认三个关键路径存在：

```bash
ls -la <server gui-tester path>/run_API.py
ls -la <server gui-tester path>/front/api_server.py
ls -la <server report-agent path>/run_report.py
ls -la <server requirement doc path>
```

确认报告 Agent 模型服务可用。报告 Agent 默认读取自己的 `.env`，本机曾见到：

```text
BASE_URL=http://127.0.0.1:8000/v1
MODEL=autoglm-phone-9b
```

服务器上必须满足其中一种：

- `inftest-report-agent/.env` 指向真实可访问的 OpenAI-compatible 模型服务。
- 或服务器本机确实启动了 `http://127.0.0.1:8000/v1`。

否则主链路会卡在报告阶段：

```text
模型调用失败：Connection error.
```

## 4. 拉代码和安装依赖

```bash
git clone <InfTest-Main-Agent repo url>
cd InfTest-Main-Agent
bun install
```

基础检查：

```bash
bun test src/inftest/__tests__
bun build scripts/inftest_task_api.ts --target=bun --outfile=/tmp/inftest_task_api.js
```

说明：

- `bun test src/inftest/__tests__` 应通过。
- `bun run typecheck` 当前可能失败在既有 `packages/builtin-tools/src/tools/WebFetchTool/utils.ts` Axios header 类型问题，和 InfTest 主 Agent 改动无关。

## 5. 启动顺序

### 5.1 启动 gui-tester API

先启动执行 Agent 依赖的 `gui-tester/front/api_server.py`。

有真实设备时：

```bash
cd <server gui-tester path>

API_PORT=<gui-tester api port> \
<server python path> \
front/api_server.py
```

暂无真实设备、只做服务器链路联调时：

```bash
cd <server gui-tester path>

API_PORT=<gui-tester api port> \
INFTEST_MOCK_DEVICE=1 \
<server python path> \
front/api_server.py
```

健康检查：

```bash
curl http://127.0.0.1:<gui-tester api port>/api/health
```

预期：

```json
{"status":"ok"}
```

### 5.2 启动 InfTest 主 Agent

推荐服务器第一条启动命令：

```bash
cd /path/to/InfTest-Main-Agent

INFTEST_HOST=0.0.0.0 \
INFTEST_PORT=8787 \
INFTEST_RUNNER=stateful \
INFTEST_CONFIG=.inftest/config.available-agents.example.json \
API_PORT=<gui-tester api port> \
INFTEST_EXECUTION_AGENT_CWD=<server gui-tester path> \
INFTEST_EXECUTION_AGENT_PYTHON=<server python path> \
INFTEST_REPORT_AGENT_CWD=<server report-agent path> \
INFTEST_REPORT_AGENT_PYTHON=<server python path> \
INFTEST_REQUIREMENT_DOC=<server requirement doc path> \
bun run scripts/inftest_task_api.ts
```

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

预期：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "status": "ok"
  }
}
```

给智能体代理服务配置的主 Agent base URL：

```text
http://<server-host>:8787
```

## 6. 首次联调验证

### 6.1 验证 Planner API（real）

这些接口已接入真实编排语义（异步受理，不阻塞执行完成）：

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

审计日志目录：

```text
.inftest-workspace/planner-api-stub/
```

注意：

- `/api/*` 现在返回 `code=0` 表示“已受理”，不等于任务已最终成功。
- `/api/task-manage START` 与 `/api/task-manage RESTART` 为异步：立即返回 `PENDING`。
- 若需要同步等待执行完成，请调用 `/tasks/alter START`。
- 任务状态查询统一使用：`GET /tasks/{exec_id}`。

### 6.2 触发 stateful runner

```bash
curl -sS -X POST http://127.0.0.1:8787/tasks/alter \
  -H 'Content-Type: application/json' \
  -d '{"exec_id":"exec-server-001","task_operation":"START"}'
```

如果设备和模型都可用，期望最终：

```json
{
  "code": 0,
  "data": {
    "exec_id": "exec-server-001",
    "task_status": "SUCCESS",
    "runner": "stateful"
  }
}
```

如果报告 Agent 模型不可用，当前预期会失败在：

```text
Report agent exited with code 1. 错误: 模型调用失败：Connection error.
```

这说明主 Agent、状态机、执行 Agent CLI 和设备层已经跑过，剩余是报告模型服务问题。

### 6.3 查询任务状态

```bash
curl http://127.0.0.1:8787/tasks/task-server-001
```

重点看：

```text
runner
task_status
current_stage
last_error
run_fake_e2e_invoked
artifacts
```

上线联调时 `run_fake_e2e_invoked` 应为：

```text
false
```

## 7. 验收产物

执行阶段成功时应存在：

```text
.inftest-workspace/<task_id>/plan.json
.inftest-workspace/<task_id>/case_generation/test_cases.json
.inftest-workspace/<task_id>/device_scheduling/device_case_bind.json
.inftest-workspace/<task_id>/device_scheduling/device_bindings.json
.inftest-workspace/<task_id>/execution/results/case_result.json
.inftest-workspace/<task_id>/execution/results/summary.json
```

`stateful` runner 还应存在实验轨迹：

```text
.inftest-workspace/<task_id>/experiment/state_transitions.jsonl
.inftest-workspace/<task_id>/experiment/skill_invocations.jsonl
.inftest-workspace/<task_id>/experiment/hooks.jsonl
.inftest-workspace/<task_id>/experiment/summary.md
```

报告阶段成功时应存在：

```text
.inftest-workspace/<task_id>/analysis/report.md
.inftest-workspace/<task_id>/analysis/result.json
```

如果报告 Agent 生成 docx，通常会保留在：

```text
.inftest-workspace/<task_id>/analysis/report_agent_output/
```

## 8. 常见失败和处理

### 8.1 主 Agent 启动失败

优先检查：

```bash
which bun
bun --version
ls -la .inftest/config.available-agents.example.json
```

如果端口被占用：

```bash
lsof -i :8787
```

换端口时同步修改代理服务 base URL。

### 8.2 执行阶段连接失败

现象：

```text
Connection refused
```

处理：

- 确认 `gui-tester/front/api_server.py` 已启动。
- 确认主 Agent 的 `API_PORT` 和 gui-tester 端口一致。
- 确认服务器防火墙或容器网络没有隔离本机端口。

看日志：

```text
.inftest-workspace/<task_id>/execution/result.json
.inftest-workspace/<task_id>/execution/logs/real_execution_agent_invocation.json
.inftest-workspace/<task_id>/execution/logs/real_execution_agent.stdout.log
.inftest-workspace/<task_id>/execution/logs/real_execution_agent.stderr.log
```

### 8.3 执行阶段没有设备

现象：

```text
未检测到可用测试设备，请先连接设备
```

处理：

- 有真设备时，先在 `gui-tester` 所在环境确认设备能被识别。
- 无真设备但允许链路联调时，只在 `gui-tester/front/api_server.py` 启动命令加 `INFTEST_MOCK_DEVICE=1`。
- 不要在主 Agent 侧设置 `INFTEST_EXECUTION_AGENT_MODE=mock`。

### 8.4 报告阶段模型连接失败

现象：

```text
模型调用失败：Connection error.
```

处理：

- 检查 `inftest-report-agent/.env` 的 `BASE_URL`、`MODEL`、`API_KEY`。
- 确认模型服务可从报告 Agent 所在机器访问。
- 确认模型服务兼容 OpenAI `/v1/chat/completions`。

看日志：

```text
.inftest-workspace/<task_id>/analysis/result.json
.inftest-workspace/<task_id>/analysis/logs/real_report_agent_invocation.json
.inftest-workspace/<task_id>/analysis/logs/real_report_agent.stdout.log
.inftest-workspace/<task_id>/analysis/logs/real_report_agent.stderr.log
```

### 8.5 Python 依赖问题

现象通常是：

```text
ModuleNotFoundError
ImportError
```

处理：

- 确认 `INFTEST_EXECUTION_AGENT_PYTHON` 指向安装了 `gui-tester` 依赖的 Python。
- 确认 `INFTEST_REPORT_AGENT_PYTHON` 指向安装了 `inftest-report-agent` 依赖的 Python。
- 不建议用系统默认 `python` 猜测，优先用绝对路径。

## 9. 服务器上线注意事项

- 主 Agent 对外监听用 `INFTEST_HOST=0.0.0.0`，端口默认用 `8787`。
- 智能体代理服务只需要访问主 Agent base URL：`http://<server-host>:8787`。
- `/api/*` Planner 接口已 real 化，建议平台统一走 `/api/*`。
- 同步触发模式仍保留 `POST /tasks/alter` 供运维验收使用。
- `INFTEST_RUNNER=stateful` 是当前推荐模式。
- `available` runner 只作为对照链路保留。
- fake E2E 保留，但上线联调不应走 fake。
- 不要修改 QueryEngine 主循环。
- 不要把 `gui-tester` 或 `inftest-report-agent` 代码合并进主 Agent。
- `.inftest-workspace/` 是运行产物目录，失败排查优先看这里。
- 如使用进程管理工具，建议分别管理两个进程：
  - `gui-tester/front/api_server.py`
  - `InfTest-Main-Agent/scripts/inftest_task_api.ts`

## 10. 最小排查顺序

失败时按这个顺序看：

1. `curl http://127.0.0.1:<gui-tester api port>/api/health`
2. `curl http://127.0.0.1:8787/health`
3. `.inftest-workspace/<task_id>/experiment/state_transitions.jsonl`
4. `.inftest-workspace/<task_id>/execution/result.json`
5. `.inftest-workspace/<task_id>/execution/logs/real_execution_agent.stdout.log`
6. `.inftest-workspace/<task_id>/analysis/result.json`
7. `.inftest-workspace/<task_id>/analysis/logs/real_report_agent.stdout.log`
8. `.inftest-workspace/planner-api-stub/`

一般判断：

- 没有 `case_result.json`：先查执行 Agent、设备、`API_PORT`。
- 有 `case_result.json` 但没有 `analysis/report.md`：先查报告 Agent 和模型服务。
- `/api/*` 有日志但没有任务 workspace：通常表示只受理了计划层请求，尚未执行 `task-manage START`。
