# InfTest 服务器部署联调手册

> 目标日期：明天服务器联调  
> 当前策略：先跑 CLI 链路，不先接 HTTP 平台入口  
> 关键结论：真实执行 Agent / 报告 Agent 都是由 InfTest 主 Agent 通过 CLI 子进程调用。

## 1. 明天目标

明天要在服务器上跑通这一条真实 Agent 链路：

```text
拉取 GitHub 代码
  -> 安装依赖
  -> 跑 fake E2E 确认主项目可运行
  -> 配置真实执行 Agent 和报告 Agent
  -> 主 Agent 写静态测试计划
  -> CLI 调用真实用例执行 Agent
  -> 读取 case_result.json / summary.json
  -> CLI 调用真实报告生成 Agent
  -> 输出 SUCCESS 和 report.md / docx 路径
```

当前不依赖用例生成 Agent，因为用例生成 Agent 暂时不可用。

## 2. 调用关系

不要把“HTTP API”和“真实 Agent 调用”混在一起。

```text
外部入口，可选
  HTTP / CLI
    |
    v
InfTest 主 Agent
    |
    | Bun.spawn / subprocess
    v
真实 CLI 子 Agent
  - 用例执行 Agent
  - 测试报告生成 Agent
```

也就是说：

- 明天优先用 `make available-agents-e2e` 跑 CLI 链路。
- HTTP server 可以之后再验证。
- 当前 HTTP `/tasks/alter START` 主要服务 fake/query demo，还没有作为真实 Agent 联调的主入口。

## 3. 服务器准备

进入服务器后先确认基础环境：

```bash
which git
which bun
bun --version
which python
python --version
conda env list
```

如果服务器没有 Bun，需要先安装 Bun，或者确认服务器已有可用路径。当前 Makefile 默认写死：

```text
/Users/chz/.bun/bin/bun
```

如果服务器不是这个路径，有两种处理方式：

1. 临时直接用服务器上的 Bun 跑脚本：

```bash
bun run typecheck
bun run scripts/inftest_fake_e2e.ts
bun run scripts/inftest_available_agents_e2e.ts
```

2. 修改服务器上的 `Makefile`：

```makefile
BUN := /path/to/server/bun
```

## 4. 拉代码

```bash
git clone git@github.com:CCChz233/InfTest-Main-Agent.git
cd InfTest-Main-Agent
```

安装依赖：

```bash
bun install
```

基础检查：

```bash
bun run typecheck
bun run scripts/inftest_fake_e2e.ts
```

预期：

- typecheck 通过
- fake E2E 输出 `status: "SUCCESS"`
- `.inftest-workspace/task-demo-001/` 下生成 plan、case、summary、report

## 5. 先单独验证真实 Agent

在接入 InfTest 主 Agent 前，先确认真实 Agent 自己能跑。

### 5.1 用例执行 Agent

根据现有文档：

```bash
conda activate inftest_server
cd /root/inftest_execute_agent
python run_API.py execute \
  --user-id u001 \
  --project-id xh \
  --task-id roger \
  --device-case-bind @./device_case_bind.sample.json \
  --used-model glm-4.7 \
  --enable-multimodal-assertion false \
  --enable-multimodal-attribution false
```

需要确认：

- 命令能正常启动
- 设备 ID 可用
- 执行结束后 `case_result.json` 实际写到了哪里
- stdout/stderr 中没有认证、模型、设备连接错误

记录真实输出路径，例如：

```text
/root/inftest_execute_agent/logs/case_result.json
```

如果不确定输出路径，先在执行 Agent 目录下查：

```bash
find . -name 'case_result.json' -o -name '*result*.json'
```

### 5.2 报告生成 Agent

根据现有文档：

```bash
cd /path/to/report_agent
python run_report.py \
  --customer "新华" \
  --project-id "xh" \
  --log-file /path/to/case_result.json \
  --doc /path/to/requirements.docx \
  --output ./output
```

需要确认：

- `requirements.docx` 文件存在
- `case_result.json` 格式符合报告 Agent 要求
- `output/summary/` 下能生成 `.md` 和 `.docx`

## 6. 配置 InfTest 调真实 CLI Agent

回到 InfTest 项目目录：

```bash
cd /path/to/InfTest-Main-Agent
```

设置环境变量。

### 6.1 执行 Agent

```bash
export INFTEST_EXECUTION_AGENT_CWD=/root/inftest_execute_agent
export INFTEST_EXECUTION_AGENT_SCRIPT=run_API.py
export INFTEST_EXECUTION_USER_ID=u001
export INFTEST_PROJECT_ID=xh
export INFTEST_EXECUTION_MODEL=glm-4.7
export INFTEST_DEVICE_ID=SM02G4061977180
```

Python 建议使用 conda 环境里的绝对路径。先查：

```bash
conda activate inftest_server
which python
```

然后设置：

```bash
export INFTEST_EXECUTION_AGENT_PYTHON=/path/from/which/python
```

如果执行 Agent 的 `case_result.json` 不在默认查找路径，必须设置：

```bash
export INFTEST_EXECUTION_CASE_RESULT=/absolute/path/to/case_result.json
```

当前默认查找顺序：

```text
$INFTEST_EXECUTION_CASE_RESULT
.inftest-workspace/{task_id}/execution/results/case_result.json
$INFTEST_EXECUTION_AGENT_CWD/logs/case_result.json
$INFTEST_EXECUTION_AGENT_CWD/output/case_result.json
$INFTEST_EXECUTION_AGENT_CWD/case_result.json
```

### 6.2 报告 Agent

```bash
export INFTEST_REPORT_AGENT_CWD=/path/to/report_agent
export INFTEST_REPORT_AGENT_SCRIPT=run_report.py
export INFTEST_REPORT_CUSTOMER=新华
export INFTEST_REQUIREMENT_DOC=/absolute/path/to/requirements.docx
```

报告 Agent Python 同样建议用绝对路径：

```bash
export INFTEST_REPORT_AGENT_PYTHON=/path/to/python
```

如只生成某类报告：

```bash
export INFTEST_REPORT_TEST_TYPE=functional
```

## 7. 跑真实 Agent 联调链路

执行：

```bash
INFTEST_CONFIG=.inftest/config.available-agents.example.json \
bun run scripts/inftest_available_agents_e2e.ts --task-id task-server-001 --timeout-seconds 900
```

如果服务器 Makefile 的 Bun 路径已改好，也可以：

```bash
INFTEST_CONFIG=.inftest/config.available-agents.example.json \
make available-agents-e2e
```

预期输出：

```json
{
  "task_id": "task-server-001",
  "status": "SUCCESS",
  "workspace": ".../.inftest-workspace/task-server-001",
  "error": null
}
```

## 8. 验收产物

检查这些文件：

```bash
ls -R .inftest-workspace/task-server-001
```

关键产物：

```text
.inftest-workspace/task-server-001/plan.json
.inftest-workspace/task-server-001/case_generation/test_cases.json
.inftest-workspace/task-server-001/device_scheduling/device_case_bind.json
.inftest-workspace/task-server-001/execution/result.json
.inftest-workspace/task-server-001/execution/results/case_result.json
.inftest-workspace/task-server-001/execution/results/summary.json
.inftest-workspace/task-server-001/execution/logs/real_execution_agent.stdout.log
.inftest-workspace/task-server-001/execution/logs/real_execution_agent.stderr.log
.inftest-workspace/task-server-001/analysis/result.json
.inftest-workspace/task-server-001/analysis/report.md
.inftest-workspace/task-server-001/analysis/logs/real_report_agent.stdout.log
.inftest-workspace/task-server-001/analysis/logs/real_report_agent.stderr.log
```

成功标准：

- runner 输出 `status: "SUCCESS"`
- `execution/result.json` 中 `success: true`
- `analysis/result.json` 中 `success: true`
- `analysis/report.md` 存在
- 如报告 Agent 生成 docx，则 `analysis/report_agent_output/summary/` 下有 `.docx`

## 9. 常见失败处理

### 9.1 `MISSING_EXECUTION_AGENT_CWD`

原因：没有设置执行 Agent 目录。

处理：

```bash
export INFTEST_EXECUTION_AGENT_CWD=/root/inftest_execute_agent
```

### 9.2 `EXECUTION_AGENT_CWD_NOT_FOUND`

原因：路径不存在或当前用户无权限。

处理：

```bash
ls -la /root/inftest_execute_agent
```

### 9.3 `EXECUTION_AGENT_FAILED`

原因：执行 Agent 自己退出非 0。

处理：

```bash
cat .inftest-workspace/task-server-001/execution/logs/real_execution_agent.stdout.log
cat .inftest-workspace/task-server-001/execution/logs/real_execution_agent.stderr.log
cat .inftest-workspace/task-server-001/execution/logs/real_execution_agent_invocation.json
```

重点看：

- conda/python 环境是否对
- 设备是否在线
- 模型参数是否可用
- `--device-case-bind` 文件是否可读

### 9.4 `CASE_RESULT_NOT_FOUND`

原因：执行 Agent 跑完了，但适配层没有找到 `case_result.json`。

处理：

```bash
find /root/inftest_execute_agent -name 'case_result.json' -o -name '*result*.json'
export INFTEST_EXECUTION_CASE_RESULT=/real/path/to/case_result.json
```

然后重跑。

### 9.5 `MISSING_REPORT_AGENT_CWD`

原因：没有设置报告 Agent 目录。

处理：

```bash
export INFTEST_REPORT_AGENT_CWD=/path/to/report_agent
```

### 9.6 `MISSING_CASE_RESULT`

原因：报告阶段没有找到：

```text
execution/results/case_result.json
```

处理：先解决执行阶段输出路径问题。

### 9.7 `REPORT_AGENT_FAILED`

处理：

```bash
cat .inftest-workspace/task-server-001/analysis/logs/real_report_agent.stdout.log
cat .inftest-workspace/task-server-001/analysis/logs/real_report_agent.stderr.log
cat .inftest-workspace/task-server-001/analysis/logs/real_report_agent_invocation.json
```

重点看：

- `requirements.docx` 是否存在
- `case_result.json` 是否包含报告 Agent 需要的字段
- 报告 Agent 的模型配置是否可用

### 9.8 `REPORT_MARKDOWN_NOT_FOUND`

原因：报告 Agent 运行成功，但没有在输出目录生成 `.md`。

处理：

```bash
find .inftest-workspace/task-server-001/analysis/report_agent_output -maxdepth 4 -type f
```

确认报告 Agent 实际输出文件名和目录结构，再调整适配脚本。

## 10. 明天建议顺序

1. 拉代码，安装依赖。
2. 跑 `bun run typecheck`。
3. 跑 `bun run scripts/inftest_fake_e2e.ts`。
4. 单独跑真实执行 Agent 原始命令。
5. 单独跑真实报告 Agent 原始命令。
6. 配置环境变量。
7. 跑 `scripts/inftest_available_agents_e2e.ts`。
8. 如果失败，先看 workspace 下 stdout/stderr/invocation 三类日志。
9. CLI 链路成功后，再考虑是否启动 HTTP server 做平台入口验证。

## 11. 明天不要先做的事

- 不要先接真实用例生成 Agent。
- 不要先做 HTTP 平台集成。
- 不要先做 PAUSE/CONTINUE 的深度执行控制。
- 不要先改 QueryEngine 主循环。

先把真实执行 Agent + 真实报告 Agent 的 CLI 链路跑通。
