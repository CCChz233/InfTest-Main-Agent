# InfTest API 全真模拟测试用例

> 日期：2026-05-26  
> 用途：记录当前 `INFTEST_RUNNER=available` 全真模拟使用的静态测试用例，方便下次复现 API 闭环。  
> 当前来源：`src/inftest/AvailableAgentsRunner.ts` 的 `buildManualCases(taskId)`。

## 0. Mock 后端端口 Query 模式用例

2026-05-27 新增的“端口模拟用户输入”链路使用：

```bash
INFTEST_RUNNER=query
INFTEST_ORCHESTRATION=stepwise
```

该模式不走 `AvailableAgentsRunner` 的静态手工用例，而是让主 Agent 通过工具调用 `mock_agents/fake_case_generation_agent.py` 生成 mock 用例。

已验证任务：

```text
task-port-query-003
```

生成产物：

```text
.inftest-workspace/task-port-query-003/case_generation/test_cases.json
```

当前生成 2 条登录模块用例：

| 用例 ID | 用例名称 | 预期结果 |
| --- | --- | --- |
| `login_normal` | 账号密码正常登录 | 登录成功，进入首页 |
| `login_wrong_password` | 错误密码登录 | 提示账号或密码错误 |

用例 1：`login_normal`

```text
前置条件：
1. 用户已注册

步骤：
1. 打开登录页
2. 输入正确账号
3. 输入正确密码
4. 点击登录

预期：
登录成功，进入首页
```

用例 2：`login_wrong_password`

```text
前置条件：
1. 用户已注册

步骤：
1. 打开登录页
2. 输入正确账号
3. 输入错误密码
4. 点击登录

预期：
提示账号或密码错误
```

设备绑定产物：

```text
.inftest-workspace/task-port-query-003/device_scheduling/device_bindings.json
```

当前绑定：

```text
login_normal -> mock-android-001 / Mock Pixel 7 / android
login_wrong_password -> mock-android-001 / Mock Pixel 7 / android
```

执行结果：

```json
{
  "task_id": "task-port-query-003",
  "total": 2,
  "passed": 2,
  "failed": 0,
  "skipped": 0,
  "status": "SUCCESS"
}
```

复用命令：

```bash
bun run scripts/inftest_mock_backend_query_e2e.ts \
  --task-id task-port-query-003 \
  --agent-port 18887 \
  --backend-port 18890
```

## 1. 当前用例总览

当前全真模拟只有 1 条静态手工用例。

| 字段 | 当前值 |
| --- | --- |
| 用例来源 | 主 Agent 静态生成 |
| 生成原因 | `cli_test_plan_agent` 当前暂不接入 |
| 用例 ID | `{task_id}_case_000` |
| 用例名称 | 首页搜索-健康关键词常规流程 |
| 测试类型 | functional |
| 功能点 | 首页搜索 |
| 测试场景 | 常规搜索流程 |
| 示例 task id | `task-api-real-001` |
| 示例 case id | `task-api-real-001_case_000` |

## 2. 用例内容

### 2.1 前置条件

```text
1. 测试设备已连接并可被执行 Agent 调度
2. 掌上新华 APP 已安装且可正常启动
3. 网络环境可访问掌上新华服务
```

说明：

- 当前本机没有可用测试设备，所以执行阶段使用 `INFTEST_EXECUTION_AGENT_MODE=mock`。
- 切回真执行时，上述前置条件必须满足。

### 2.2 操作步骤

```text
1. 退到桌面
2. 打开掌上新华APP
3. 点击首页搜索框
4. 输入关键字“健康”并执行搜索
```

### 2.3 预期结果

```text
1. 成功退到桌面
2. APP成功启动并进入首页
3. 搜索框可正常聚焦并输入
4. 返回包含关键字相关的搜索结果列表
```

## 3. 代码里的源数据

源文件：

```text
src/inftest/AvailableAgentsRunner.ts
```

当前静态用例定义：

```ts
{
  case_id: `${taskId}_case_000`,
  case_name: '首页搜索-健康关键词常规流程',
  test_type: 'functional',
  case_function_point: '首页搜索',
  test_scenario: '常规搜索流程',
  case_step: [
    '退到桌面',
    '打开掌上新华APP',
    '点击首页搜索框',
    '输入关键字“健康”并执行搜索',
  ],
  expected_result: [
    '成功退到桌面',
    'APP成功启动并进入首页',
    '搜索框可正常聚焦并输入',
    '返回包含关键字相关的搜索结果列表',
  ],
}
```

## 4. 生成的测试计划产物

API 成功任务示例：

```text
.inftest-workspace/task-api-real-001/case_generation/test_cases.json
```

当前形态：

```json
{
  "source": "manual_static_plan",
  "reason": "case_generation_agent_unavailable",
  "root": {
    "node_id": "root",
    "title": "掌上新华 APP 首页搜索测试",
    "children": [
      {
        "node_id": "task-api-real-001_case_000",
        "title": "首页搜索-健康关键词常规流程",
        "type": "CASE",
        "test_type": "functional",
        "case_function_point": "首页搜索",
        "test_scenario": "常规搜索流程",
        "preconditions": [
          "测试设备已连接并可被执行 Agent 调度",
          "掌上新华 APP 已安装且可正常启动",
          "网络环境可访问掌上新华服务"
        ],
        "test_steps": [
          "退到桌面",
          "打开掌上新华APP",
          "点击首页搜索框",
          "输入关键字“健康”并执行搜索"
        ],
        "expected_result": [
          "成功退到桌面",
          "APP成功启动并进入首页",
          "搜索框可正常聚焦并输入",
          "返回包含关键字相关的搜索结果列表"
        ]
      }
    ]
  }
}
```

## 5. 生成的设备用例绑定

产物路径：

```text
.inftest-workspace/<task_id>/device_scheduling/device_case_bind.json
```

当前默认设备 ID：

```text
SM02G4061977180
```

可通过环境变量覆盖：

```bash
export INFTEST_DEVICE_ID=<your_device_id>
```

当前 `task-api-real-001` 示例：

```json
{
  "device_case": {
    "SM02G4061977180": {
      "case_step": [
        "退到桌面",
        "打开掌上新华APP",
        "点击首页搜索框",
        "输入关键字“健康”并执行搜索"
      ],
      "case_function_point": "首页搜索",
      "test_scenario": "常规搜索流程",
      "expected_result": [
        "成功退到桌面",
        "APP成功启动并进入首页",
        "搜索框可正常聚焦并输入",
        "返回包含关键字相关的搜索结果列表"
      ],
      "case_id": "task-api-real-001_case_000"
    }
  }
}
```

## 6. 执行 Agent 输入形态

当前 `gui-tester/run_API.py` 的真实入口需要 Markdown 用例文件。

执行 adapter 会从 `device_case_bind.json` 生成：

```text
.inftest-workspace/<task_id>/execution/inputs/test_cases.md
```

当前示例内容：

```text
案例1操作步骤：退到桌面，打开掌上新华APP，点击首页搜索框，输入关键字“健康”并执行搜索
案例1预期结果：成功退到桌面，APP成功启动并进入首页，搜索框可正常聚焦并输入，返回包含关键字相关的搜索结果列表
```

真实执行模式会调用：

```bash
python run_API.py \
  --case <workspace>/execution/inputs/test_cases.md \
  --json <workspace>/execution/results/case_result.json
```

## 7. 当前 mock 执行结果

本机无可用测试设备时使用：

```bash
export INFTEST_EXECUTION_AGENT_MODE=mock
```

mock 执行会生成：

```text
.inftest-workspace/<task_id>/execution/results/case_result.json
.inftest-workspace/<task_id>/execution/results/summary.json
```

当前 mock 的业务含义：

```text
1 条用例执行通过。
4 个步骤均为 passed。
functional.status = passed。
```

`summary.json` 示例：

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

`case_result.json` 的关键字段：

```json
{
  "cases": [
    {
      "task_id": "task-api-real-001",
      "case_index": 1,
      "case_id": "task-api-real-001_case_000",
      "case_name": "常规搜索流程",
      "test_type": "functional",
      "case_step": "退到桌面\n打开掌上新华APP\n点击首页搜索框\n输入关键字“健康”并执行搜索",
      "expected_result": [
        "成功退到桌面",
        "APP成功启动并进入首页",
        "搜索框可正常聚焦并输入",
        "返回包含关键字相关的搜索结果列表"
      ],
      "status": "pass",
      "functional": {
        "status": "passed",
        "test_type": "functional",
        "scene": "常规搜索流程",
        "expected_result": "成功退到桌面；APP成功启动并进入首页；搜索框可正常聚焦并输入；返回包含关键字相关的搜索结果列表",
        "actual_result": "Mock execution completed successfully."
      },
      "risk_level": "low"
    }
  ]
}
```

## 8. 报告 Agent 期望输入

报告 Agent 的输入文件就是：

```text
.inftest-workspace/<task_id>/execution/results/case_result.json
```

当前这条用例能被报告 Agent 解析的关键条件：

- 顶层是 `{ "cases": [...] }`
- 每个 case 有 `case_id`
- 每个 case 有 `status`
- 每个 case 有 `steps_info`
- 每个 case 有顶层 `functional`
- `functional.status = "passed"`
- `functional.test_type = "functional"`

报告 Agent 成功后生成：

```text
.inftest-workspace/<task_id>/analysis/report.md
.inftest-workspace/<task_id>/analysis/report_agent_output/总报告/整合测试报告_新华_xh.md
.inftest-workspace/<task_id>/analysis/report_agent_output/总报告/整合测试报告_新华_xh.docx
.inftest-workspace/<task_id>/analysis/report_agent_output/总报告/缺陷统计明细_整合_新华_xh.json
```

## 9. 下次复用命令

### 9.1 启动本地模型 stub

```bash
cd /Users/chz/workspace/inftest-runtime/InfTest-Main-Agent
.venv-inftest-py313/bin/python scripts/inftest_mock_openai_server.py --host 127.0.0.1 --port 8000
```

### 9.2 跑 API 全真模拟

启动 API：

```bash
INFTEST_RUNNER=available \
INFTEST_EXECUTION_AGENT_MODE=mock \
INFTEST_CONFIG=.inftest/config.available-agents.example.json \
INFTEST_REPORT_AGENT_CWD=/Users/chz/workspace/inftest-runtime/inftest-report-agent \
INFTEST_REPORT_AGENT_PYTHON=/Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.venv-inftest-py313/bin/python \
INFTEST_REQUIREMENT_DOC='/Users/chz/workspace/inftest-runtime/docs/Kongming（孔明）—— AI 原生质量OS (1).docx' \
/Users/chz/.bun/bin/bun run scripts/inftest_task_api.ts
```

调用任务：

```bash
curl -sS -X POST http://127.0.0.1:8787/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-api-real-001","task_operation":"START"}'
```

成功标准：

```text
runner=available
task_status=SUCCESS
```

关键产物：

```text
.inftest-workspace/task-api-real-001/plan.json
.inftest-workspace/task-api-real-001/device_scheduling/device_case_bind.json
.inftest-workspace/task-api-real-001/execution/results/case_result.json
.inftest-workspace/task-api-real-001/execution/results/summary.json
.inftest-workspace/task-api-real-001/analysis/report.md
```

## 10. 如何新增下一条静态用例

当前静态用例在：

```text
src/inftest/AvailableAgentsRunner.ts
```

修改位置：

```text
buildManualCases(taskId)
```

新增用例时至少填写：

```text
case_id
case_name
test_type
case_function_point
test_scenario
case_step
expected_result
```

注意：

- `buildDeviceCaseBindArtifact` 当前只绑定 `cases[0]`。
- 如果要一次跑多条静态用例，需要同步扩展 `buildDeviceCaseBindArtifact`，让 `device_case` 能包含多条 case。
- 执行 adapter 的 mock 模式已经能遍历 `device_case_bind.json` 里的多条 case。

## 11. 当前结论

当前全真模拟测试用例是：

```text
掌上新华 APP 首页搜索：输入“健康”关键词并验证搜索结果列表。
```

它的定位是：

- 用来验证主 Agent API 链路，不是最终业务用例全集。
- 用来替代暂未接入的用例生成 Agent。
- 用来给执行 Agent 和报告 Agent 提供稳定、可复现的最小输入。
