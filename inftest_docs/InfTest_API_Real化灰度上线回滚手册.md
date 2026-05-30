# InfTest API Real 化灰度上线回滚手册

> 更新日期：2026-05-29  
> 目标：将 `/api/*` 从 stub 迁移为 real，确保生产可回滚、可观测、可追踪。

## 1. 变更范围

本次 real 化接口：

- `POST /api/generate-plan`
- `POST /api/plan-task-publish`
- `POST /api/case-publish`
- `POST /api/task-report-generate`
- `POST /api/task-manage`
- `POST /api/user-instruction`
- `POST /api/payload`

保持不变：

- `GET /health`
- `POST /tasks/alter`
- `POST /tasks/terminate`
- `GET /tasks/{exec_id}`
- `POST /tasks/chat/stream`

## 2. 上线前检查

```bash
systemctl is-active inftest-main-agent
curl -sS http://127.0.0.1:8787/health
```

```bash
cd /root/InfTest-Main-Agent
/root/.bun/bin/bun run typecheck
/root/.bun/bin/bun test src/inftest/__tests__/plannerApiStub.test.ts src/inftest/__tests__/taskApi.test.ts
```

## 3. 灰度步骤

1. 先灰度 `proxy-generate-plan` 链路（只走计划层，不触发设备执行）。
2. 再灰度 `proxy-plan-task-publish` 与 `proxy-case-publish`。
3. 最后灰度 `proxy-task-manage START`（真实执行触发）。

每一步都要求：

- HTTP `code=0`
- `.inftest-workspace/planner-api-stub/` 有对应 `request_id` 日志
- `GET /tasks/{exec_id}` 可观察状态推进（`PENDING -> RUNNING -> SUCCESS/FAILED`）

## 4. 观测点

### 4.1 主服务日志

```bash
journalctl -u inftest-main-agent -f
```

### 4.2 请求审计

```text
/root/InfTest-Main-Agent/.inftest-workspace/planner-api-stub/<request_id>.json
```

### 4.3 任务执行产物

```text
/data/inftest-workspace/<exec_id>/
```

重点文件：

- `execution/result.json`
- `execution/logs/real_execution_agent.stdout.log`
- `execution/results/case_result.json`
- `execution/results/summary.json`
- `analysis/result.json`
- `analysis/report.md`

## 5. 回滚策略

### 5.1 代码回滚

回滚以下文件到上一稳定版本：

- `src/inftest/server/plannerApiStub.ts`
- `src/inftest/server/plannerApiRealHandler.ts`
- `src/inftest/server/taskExecutionService.ts`

### 5.2 服务回滚

```bash
systemctl restart inftest-main-agent
curl -sS http://127.0.0.1:8787/health
```

### 5.3 联调回滚口径

如需快速降级，暂时要求上游改走：

- 同步模式：`POST /tasks/alter START`
- 查询模式：`GET /tasks/{exec_id}`

## 6. 常见风险与处理

- 风险：`/api/task-manage START` 频繁重复触发  
  - 处理：上游必须传稳定 `request_id`，并对同 `exec_id` 做幂等控制。

- 风险：`/api/task-report-generate` 在任务运行中被调用  
  - 处理：返回可重试状态，等待 `GET /tasks/{exec_id}` 进入终态后重试。

- 风险：设备链路超时导致任务失败  
  - 处理：优先检查执行日志中的 bridge 超时与设备在线状态。

## 7. 对外联调口径（给平台）

- `/api/*` 已 real 化，成功表示“请求已受理”，不是“任务最终成功”。
- 最终状态统一从 `GET /tasks/{exec_id}` 获取。
- 失败时请携带 `request_id` 回传，便于按审计日志精准排查。
