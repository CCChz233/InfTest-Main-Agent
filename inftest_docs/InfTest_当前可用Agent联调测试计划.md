# InfTest 当前可用 Agent 联调测试计划

> 更新日期：2026-05-25

## 1. 当前状态

| Agent | 当前状态 | 本轮处理方式 |
|------|----------|--------------|
| 用例生成 Agent | 不可用 | 暂时不调用，由主 Agent 写入手工/静态测试计划 |
| 用例执行 Agent | 可用 | 通过 `scripts/inftest_real_execution_agent_adapter.py` 适配现有命令 |
| 测试报告生成 Agent | 可用 | 通过 `scripts/inftest_real_report_agent_adapter.py` 适配现有命令 |

因此当前可跑通的整体流程不是“生成用例 Agent -> 执行 Agent -> 报告 Agent”，而是：

```text
用户任务
  -> InfTest 主 Agent 生成手工测试计划
  -> 写入 device_case_bind.json
  -> CLI 调用用例执行 Agent
  -> 整理 case_result.json / summary.json
  -> CLI 调用报告生成 Agent
  -> 返回 SUCCESS / FAILED 和产物路径
```

原来的 deterministic fake E2E 不变，仍用 `make fake-e2e` 验收基础闭环。

明天服务器联调优先看：[InfTest 服务器部署联调手册](./InfTest_服务器部署联调手册.md)。

> 注意：真实执行 Agent 和报告 Agent 是 CLI 调用，不是 HTTP 调用。HTTP 只是未来平台启动 InfTest 主 Agent 的外部入口。

## 2. 本轮新增的运行入口

```bash
make available-agents-e2e
```

默认情况下，这个命令会使用现有 fake 执行/报告 Agent 做本地烟测，验证“跳过用例生成 Agent”的编排链路本身可跑通。

真实 Agent 联调时，建议只在本次命令中指定 `.inftest/config.available-agents.example.json`，避免影响 `make fake-e2e`。该配置会让 `SubAgentAdapter` 改为调用真实 Agent 适配脚本：

```json
{
  "subagents": {
    "test_executor": {
      "command": "python3",
      "args": ["scripts/inftest_real_execution_agent_adapter.py"]
    },
    "result_analyzer": {
      "command": "python3",
      "args": ["scripts/inftest_real_report_agent_adapter.py"]
    }
  }
}
```

## 3. 手工测试计划

当前先固定一条可执行用例，用于打通执行和报告链路。

| 字段 | 内容 |
|------|------|
| 测试对象 | 掌上新华 APP |
| 功能点 | 首页搜索 |
| 测试场景 | 常规搜索流程 |
| 用例类型 | functional |
| 设备 ID | `SM02G4061977180`，可用 `INFTEST_DEVICE_ID` 覆盖 |
| 用例 ID | `{task_id}_case_000` |

步骤：

1. 退到桌面
2. 打开掌上新华 APP
3. 点击首页搜索框
4. 输入关键字“健康”并执行搜索

预期结果：

1. 成功退到桌面
2. APP 成功启动并进入首页
3. 搜索框可正常聚焦并输入
4. 返回包含关键字相关的搜索结果列表

运行后会写入：

```text
.inftest-workspace/task-available-001/plan.json
.inftest-workspace/task-available-001/case_generation/test_cases.json
.inftest-workspace/task-available-001/device_scheduling/device_case_bind.json
.inftest-workspace/task-available-001/device_scheduling/device_bindings.json
.inftest-workspace/task-available-001/execution/results/case_result.json
.inftest-workspace/task-available-001/execution/results/summary.json
.inftest-workspace/task-available-001/analysis/report.md
```

## 4. 用例执行 Agent 真实联调

执行 Agent 原始命令来自文档：

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

适配层会把 InfTest workspace 中的：

```text
device_scheduling/device_case_bind.json
```

转换为执行 Agent 的 `--device-case-bind @...` 入参。

真实运行前需要设置：

```bash
export INFTEST_EXECUTION_AGENT_CWD=/root/inftest_execute_agent
export INFTEST_EXECUTION_AGENT_PYTHON=python
export INFTEST_EXECUTION_AGENT_SCRIPT=run_API.py
export INFTEST_EXECUTION_USER_ID=u001
export INFTEST_PROJECT_ID=xh
export INFTEST_EXECUTION_MODEL=glm-4.7
```

如果执行 Agent 的 `case_result.json` 不在默认位置，需要额外设置：

```bash
export INFTEST_EXECUTION_CASE_RESULT=/path/to/case_result.json
```

当前适配层会按顺序查找：

```text
$INFTEST_EXECUTION_CASE_RESULT
.inftest-workspace/{task_id}/execution/results/case_result.json
$INFTEST_EXECUTION_AGENT_CWD/logs/case_result.json
$INFTEST_EXECUTION_AGENT_CWD/output/case_result.json
$INFTEST_EXECUTION_AGENT_CWD/case_result.json
```

## 5. 报告生成 Agent 真实联调

报告 Agent 原始命令来自文档：

```bash
python run_report.py \
  --customer "新华" \
  --project-id "sojourn" \
  --log-file logs/case_result.json \
  --doc requirements.docx \
  --output ./output
```

适配层会把执行阶段产物：

```text
execution/results/case_result.json
```

作为 `--log-file`，并把报告输出写到：

```text
analysis/report_agent_output/
analysis/report.md
```

真实运行前需要设置：

```bash
export INFTEST_REPORT_AGENT_CWD=/path/to/report_agent
export INFTEST_REPORT_AGENT_PYTHON=python
export INFTEST_REPORT_AGENT_SCRIPT=run_report.py
export INFTEST_REPORT_CUSTOMER=新华
export INFTEST_PROJECT_ID=xh
export INFTEST_REQUIREMENT_DOC=/path/to/requirements.docx
```

如果只想生成某一类报告：

```bash
export INFTEST_REPORT_TEST_TYPE=functional
```

## 6. 验收步骤

### 本地编排烟测

```bash
make typecheck
make available-agents-e2e
```

预期：

- 输出 JSON 中 `status` 为 `SUCCESS`
- `plan.json` 存在且可解析
- `device_case_bind.json` 符合执行 Agent 文档格式
- `execution/results/case_result.json` 符合报告 Agent 文档格式
- `analysis/report.md` 存在

### 真实 Agent 联调

```bash
export INFTEST_EXECUTION_AGENT_CWD=/root/inftest_execute_agent
export INFTEST_REPORT_AGENT_CWD=/path/to/report_agent
export INFTEST_REQUIREMENT_DOC=/path/to/requirements.docx

INFTEST_CONFIG=.inftest/config.available-agents.example.json \
bun run scripts/inftest_available_agents_e2e.ts --task-id task-server-001 --timeout-seconds 900
```

预期：

- 执行 Agent 被实际调用
- 报告 Agent 被实际调用
- 最终 `status` 为 `SUCCESS`
- 执行 stdout/stderr 记录在 `execution/logs/`
- 报告 stdout/stderr 记录在 `analysis/logs/`

## 7. 当前限制

- 用例生成 Agent 不可用，所以当前测试计划是主 Agent 写入的静态计划。
- 执行 Agent 文档没有明确说明真实 `case_result.json` 输出路径；如不在默认位置，需要设置 `INFTEST_EXECUTION_CASE_RESULT`。
- 报告 Agent 需要需求文档 `requirements.docx`；本地没有真实项目 PRD 时，必须由你提供。
- 如果执行 Agent 只能在远端服务器运行，需要在远端服务器执行上述命令，或者把执行 Agent CLI 暴露到本机可调用路径。
- 这条链路先验证“主 Agent 编排 + 可用 Agent 接入”，还不是完整的“用户确认用例 -> 多类型测试 Agent 并发分发 -> 运行中动态打断重排”。
