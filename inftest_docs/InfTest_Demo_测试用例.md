# InfTest Demo 测试用例

> 更新日期：2026-05-25

## 1. 测试目标

本文档用于验证当前 InfTest 主 Agent demo 的可运行能力，包括：

- HTTP server 健康检查
- deterministic fake E2E 成功链路
- 任务 session 查询
- PAUSE / CONTINUE / TERMINATE 控制接口
- 用户中途要求修改用例时的当前模拟方案
- query runner 调用 `run_fake_e2e` tool
- stepwise 模式下 PAUSE 阻断后续子 Agent 的设计验证

当前测试范围是 task-level demo，不是完整 plan-level Planner Agent。

## 2. 测试前准备

进入仓库根目录：

```bash
cd /Users/chz/workspace/claude-code-cli
```

基础检查：

```bash
make typecheck
make fake-e2e
```

启动 HTTP server：

```bash
INFTEST_PORT=39001 make server
```

以下 HTTP 用例默认使用：

```text
http://127.0.0.1:39001
```

如果端口被占用，请替换为实际端口。

## 3. 测试用例

### TC-01 健康检查

**目标**

确认 HTTP server 正常启动。

**步骤**

```bash
curl -sS http://127.0.0.1:39001/health
```

**预期结果**

返回成功响应，内容包含：

```json
{
  "code": 0,
  "data": {
    "status": "ok"
  }
}
```

---

### TC-02 正常启动并跑完整 fake E2E

**目标**

验证主流程能从 `START` 跑到 `SUCCESS`。

**步骤**

```bash
curl -sS -X POST http://127.0.0.1:39001/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-demo-001","task_operation":"START"}'
```

**预期结果**

- 返回成功响应
- `task_status` 为 `SUCCESS`
- 返回 workspace 路径
- 返回 artifacts
- 生成以下关键文件：

```text
.inftest-workspace/task-demo-001/plan.json
.inftest-workspace/task-demo-001/case_generation/test_cases.json
.inftest-workspace/task-demo-001/device_scheduling/device_bindings.json
.inftest-workspace/task-demo-001/execution/results/summary.json
.inftest-workspace/task-demo-001/analysis/report.md
```

---

### TC-03 启动后查询任务状态

**目标**

验证任务 session 能被保存和查询。

**步骤**

```bash
curl -sS -X POST http://127.0.0.1:39001/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-query-001","task_operation":"START"}'

curl -sS http://127.0.0.1:39001/tasks/task-query-001
```

**预期结果**

- 可以查到任务详情
- `task_id` 为 `task-query-001`
- `task_status` 最终为 `SUCCESS`
- message 包含 completed successfully 或同义成功信息

---

### TC-04 暂停不存在的任务

**目标**

验证异常任务控制请求的处理。

**步骤**

```bash
curl -sS -X POST http://127.0.0.1:39001/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"missing-task","task_operation":"PAUSE"}'
```

**预期结果**

- 返回 404
- message 说明 task 不存在
- 不应创建新的 session

---

### TC-05 任务完成后执行 PAUSE

**目标**

验证当前实现下，对终态任务执行 PAUSE 的行为。

**步骤**

```bash
curl -sS -X POST http://127.0.0.1:39001/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-pause-after-success","task_operation":"START"}'

curl -sS -X POST http://127.0.0.1:39001/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-pause-after-success","task_operation":"PAUSE"}'

curl -sS http://127.0.0.1:39001/tasks/task-pause-after-success
```

**当前预期结果**

- PAUSE 会把 session 状态改成 `PAUSED`

**备注**

这是当前实现行为。正式版本建议限制终态任务不允许 PAUSE。

---

### TC-06 PAUSE 后 CONTINUE

**目标**

验证基础暂停/继续状态切换。

**步骤**

```bash
curl -sS -X POST http://127.0.0.1:39001/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-pause-continue-001","task_operation":"START"}'

curl -sS -X POST http://127.0.0.1:39001/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-pause-continue-001","task_operation":"PAUSE"}'

curl -sS -X POST http://127.0.0.1:39001/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-pause-continue-001","task_operation":"CONTINUE"}'

curl -sS http://127.0.0.1:39001/tasks/task-pause-continue-001
```

**当前预期结果**

- PAUSE 后状态变为 `PAUSED`
- CONTINUE 后状态变为 `RUNNING`

**备注**

当前 fake E2E 执行很快，此用例主要验证状态接口，不代表真实挂起运行中 Agent。

---

### TC-07 启动后 TERMINATE

**目标**

验证终止接口。

**步骤**

```bash
curl -sS -X POST http://127.0.0.1:39001/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-terminate-001","task_operation":"START"}'

curl -sS -X POST http://127.0.0.1:39001/tasks/terminate \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-terminate-001"}'

curl -sS http://127.0.0.1:39001/tasks/task-terminate-001
```

**当前预期结果**

- 状态变为 `TERMINATED`
- 如果有运行中的子 Agent，会尝试 kill

**备注**

由于 fake agent 执行很快，TERMINATE 通常发生在任务已完成后。

---

### TC-08 中途打断：用户认为用例不行，要求终止重跑

**目标**

模拟用户在执行期间认为当前用例不合适，要求终止当前任务并基于新版本重新执行。

**步骤**

```bash
curl -sS -X POST http://127.0.0.1:39001/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-change-case-001","task_operation":"START"}'

curl -sS -X POST http://127.0.0.1:39001/tasks/terminate \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-change-case-001"}'

curl -sS -X POST http://127.0.0.1:39001/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-change-case-001-v2","task_operation":"START"}'
```

**当前预期结果**

- `task-change-case-001` 被标记为 `TERMINATED`，或已完成后再被终止
- `task-change-case-001-v2` 能重新跑到 `SUCCESS`
- 两个任务产物目录分开：

```text
.inftest-workspace/task-change-case-001/
.inftest-workspace/task-change-case-001-v2/
```

**当前限制**

现在还没有“用户上传新版用例并替换原用例”的正式接口，所以当前只能通过新 task 模拟重跑。

正式版本应支持：

```text
终止当前执行
保存用户最新确认的用例版本
重新设备调度
重新执行测试任务
```

---

### TC-09 Query runner 模式调用 run_fake_e2e

**目标**

验证 CCB headless QueryEngine 包装层能驱动 fake E2E。

**启动服务**

```bash
INFTEST_RUNNER=query INFTEST_PORT=39002 make server
```

**步骤**

```bash
curl -sS -X POST http://127.0.0.1:39002/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-query-runner-001","task_operation":"START"}'
```

**预期结果**

- runner 为 `query`
- `run_fake_e2e_invoked` 为 `true`
- `task_status` 为 `SUCCESS`

**备注**

该用例依赖本机 CCB 模型认证和模型环境。如果模型不可用，优先使用默认 fake runner 验证基础链路。

---

### TC-10 Stepwise Query 模式下 PAUSE 阻止后续子 Agent

**目标**

验证用户 PAUSE 后，主 Agent 不应继续启动新的子 Agent。

**启动服务**

```bash
INFTEST_RUNNER=query INFTEST_ORCHESTRATION=stepwise INFTEST_PORT=39003 make server
```

**步骤**

先启动任务：

```bash
curl -sS -X POST http://127.0.0.1:39003/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-stepwise-pause-001","task_operation":"START"}'
```

在任务执行中尽快暂停：

```bash
curl -sS -X POST http://127.0.0.1:39003/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-stepwise-pause-001","task_operation":"PAUSE"}'
```

**当前预期结果**

- 如果 PAUSE 发生在下一次 `invoke_subagent` 前，tool 会拒绝继续启动子 Agent
- 错误信息中会包含：

```text
Task is PAUSED (stepwise mode)
```

**当前限制**

fake agent 执行很快，人工 curl 可能来不及稳定复现。更稳定的测试需要引入 slow fake agent 或测试注入延迟。

## 4. 测试分组建议

### Smoke 测试

- TC-01 健康检查
- TC-02 fake E2E 成功
- TC-03 查询任务状态

### 控制流测试

- TC-04 暂停不存在任务
- TC-05 完成后 PAUSE
- TC-06 PAUSE / CONTINUE 状态切换
- TC-07 TERMINATE
- TC-08 用户修改用例后终止重跑

### Agent 编排测试

- TC-09 Query runner 调用 `run_fake_e2e`
- TC-10 Stepwise 模式中 PAUSE 阻断后续子 Agent

## 5. 当前测试边界

- 当前 demo 不是完整 plan-level Planner Agent。
- 当前没有正式 `/api/generate-plan`、`/api/batch-execute-tasks`、`/api/case-publish`。
- 当前没有真实子 Agent。
- 当前没有真实 proxy 上报。
- 当前没有正式“替换用例并续跑”的接口。
- 当前 PAUSE 主要是状态控制，不是 OS 级挂起。
- 当前 TERMINATE 可尝试 abort QueryEngine 和 kill 已登记子进程，但对孙进程不保证递归清理。

## 6. 后续建议补充的测试能力

为了稳定验证“中途打断正在运行的 Agent”，建议后续新增测试专用能力：

- fake 子 Agent 支持 `--sleep-seconds`
- 或新增 slow fake agent
- task session 暴露当前阶段
- `/tasks/alter PAUSE` 后能稳定观察到后续 `invoke_subagent` 被阻断
- `/tasks/terminate` 后能稳定观察到运行中子进程被 kill
