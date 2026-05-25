# CCB InfTest 开发进度

> 记录日期：2026-05-19

## 当前目标

把 CCB 作为 InfTest Planner/Reflection 主 Agent 的运行时，先完成最小可验证链路：

1. Headless 调用 `QueryEngine.submitMessage`
2. 注册 InfTest 自定义工具
3. 生成任务 workspace 和 `plan.json`
4. 后续接入 `invoke_subagent` 和 fake 子 Agent 闭环

## 已完成

- 已阅读 `inftest_docs/` 下三份设计文档。
- 已确认主入口应走 `QueryEngine.submitMessage`，不是 `REPL.tsx`。
- 已确认第一版不改 `queryLoop` 主体、不改 `forkedAgent` 和 swarm backend。
- 已定位工具接入方式：构造 `Tools` 数组传入 `QueryEngineConfig.tools`。
- 已新增 `.gitignore` 规则忽略 `.inftest-workspace/` 运行时产物。
- 已恢复依赖环境到可执行类型检查的状态。
- 已运行 `/Users/chz/.bun/bin/bun run typecheck`，结果通过。
- 已新增 deterministic fake E2E runner：
  - `src/inftest/FakeE2ERunner.ts`
  - `scripts/inftest_fake_e2e.ts`
  - `package.json` 脚本 `inftest:fake-e2e`
- 已新增 InfTest HTTP API：
  - `src/inftest/server/taskApi.ts`
  - `scripts/inftest_task_api.ts`
  - `package.json` 脚本 `inftest:server`
- 已新增根目录 `Makefile`，统一封装 `typecheck`、`build`、`dev`、`fake-e2e`、`server`。
- 已新增 demo 操作手册：`inftest_docs/CCB_InfTest_操作手册.md`。
- 已新增 InfTest 文档索引：`inftest_docs/README.md`。
- 已新增服务器部署联调手册：`inftest_docs/InfTest_服务器部署联调手册.md`。
- 已新增 demo 测试用例文档：`inftest_docs/InfTest_Demo_测试用例.md`。
- 已新增当前可用 Agent 联调测试计划：`inftest_docs/InfTest_当前可用Agent联调测试计划.md`。
- 已实现 `SubAgentAdapter` 的 `timeout_seconds` 和运行中子进程登记。
- 已抽出 `ExecutionResultWatcher`，供 tool 和 fake E2E runner 复用。
- 已验收 fake E2E 和 HTTP `/task START` 均返回 `SUCCESS`。
- 已新增 `run_fake_e2e` InfTest tool，内部复用现有 deterministic `FakeE2ERunner`。
- 已新增 `InfTestQueryRunner`，通过 `QueryEngine.submitMessage` 要求模型调用 `run_fake_e2e`。
- `POST /task` 支持 runner 模式切换：
  - 默认 `INFTEST_RUNNER` 未设置时走 deterministic fake runner。
  - `INFTEST_RUNNER=query` 时走 `InfTestQueryRunner`。
- 已新增“当前可用 Agent”runner：
  - `src/inftest/AvailableAgentsRunner.ts`
  - `scripts/inftest_available_agents_e2e.ts`
  - `make available-agents-e2e`
- 已新增真实执行/报告 Agent 的协议适配脚本：
  - `scripts/inftest_real_execution_agent_adapter.py`
  - `scripts/inftest_real_report_agent_adapter.py`
  - `.inftest/config.available-agents.example.json`

## 已落地模块

- 新增 `src/inftest/` 基础目录。
- 新增 InfTest prompt、schema、workspace/proxy adapter。
- 新增第一批 InfTest tools：
  - `get_task_detail`
  - `init_workspace`
  - `write_plan_dag`
  - `invoke_subagent`
  - `watch_execution_results`
  - `report_task_update`
  - `control_task`
  - `read_artifact`
  - `write_artifact`
- 新增 `scripts/inftest_headless_test.ts`，用于验证绕过 REPL 调用 `QueryEngine`。
- 新增 query runner 单测：
  - `src/inftest/__tests__/InfTestQueryRunner.test.ts`
- 新增 `mock_agents/` fake 子 Agent：
  - `fake_case_generation_agent.py`
  - `fake_device_scheduler.py`
  - `fake_execution_agent.py`
  - `fake_result_analysis_agent.py`
- 已用 `python3` 手工验证 fake 子 Agent 能按 `--output-json` 写主结果。
- fake E2E 固定链路：
  - `get_task_detail`
  - `init_workspace`
  - `write_plan_dag`
  - `invoke_subagent:test_generation`
  - `invoke_subagent:device_scheduler`
  - `invoke_subagent:test_executor`
  - `watch_execution_results`
  - `invoke_subagent:result_analyzer`
  - `report_task_update:SUCCESS`
- 当前可用 Agent 联调链路：
  - `get_task_detail`
  - `init_workspace`
  - `write_manual_plan`
  - `write_device_case_bind`
  - `invoke_subagent:test_executor`
  - `watch_execution_results`
  - `normalize_report_agent_input`
  - `invoke_subagent:result_analyzer`
  - `report_task_update:SUCCESS`

## 当前阻塞

- `bun` 本体已确认存在：`/Users/chz/.bun/bin/bun`，版本 `1.3.14`。
- Codex shell 的 `PATH` 仍未包含 `/Users/chz/.bun/bin`，所以直接执行 `bun` 仍会失败。
- 后续统一使用根目录 `Makefile` 运行常用命令；`Makefile` 固定使用 `/Users/chz/.bun/bin/bun` 并显式设置 PATH。
- `node_modules/.bin/tsc` 已存在。
- 用绝对路径执行 `/Users/chz/.bun/bin/bun run typecheck` 已通过。
- 当前沙箱内监听 localhost 端口可能需要提升权限；HTTP server 建议在本机终端用 `make server` 验证。
- 真实用例执行 Agent 位于示例路径 `/root/inftest_execute_agent`，当前 Codex 本机环境无法直接访问；真实联调需要在有该目录和 `inftest_server` 环境的机器执行。
- 测试报告生成 Agent 的本机路径和真实 `requirements.docx` 尚未提供；接真实报告 Agent 前需要配置 `INFTEST_REPORT_AGENT_CWD` 和 `INFTEST_REQUIREMENT_DOC`。
- 执行 Agent 文档没有明确说明 `case_result.json` 的输出路径；若不在默认位置，需要配置 `INFTEST_EXECUTION_CASE_RESULT`。

## 设计决定

- 本地开发默认 workspace root 使用仓库内 `.inftest-workspace/`。
- 可通过 `INFTEST_WORKSPACE_ROOT` 覆盖 workspace root，以兼容平台侧 `/workspace/{task_id}`。
- 工具结果统一返回结构化 JSON 字符串给模型。
- 文件写入统一通过 `WorkspaceManager` 做 task id 和相对路径校验，避免路径穿越。

## 下一步

明天优先做服务器真实 Agent CLI 联调，不先扩 HTTP 平台入口：

1. 在服务器拉取 GitHub 仓库并安装依赖。
2. 运行 `bun run typecheck` 和 `bun run scripts/inftest_fake_e2e.ts`，确认主项目在服务器可运行。
3. 单独运行真实用例执行 Agent 原始 CLI 命令，确认设备、模型、环境可用。
4. 单独运行真实报告生成 Agent 原始 CLI 命令，确认 `requirements.docx` 和输出目录可用。
5. 设置 `INFTEST_EXECUTION_AGENT_*`、`INFTEST_REPORT_AGENT_*`、`INFTEST_REQUIREMENT_DOC` 等环境变量。
6. 运行：

```bash
INFTEST_CONFIG=.inftest/config.available-agents.example.json \
bun run scripts/inftest_available_agents_e2e.ts --task-id task-server-001 --timeout-seconds 900
```

7. 检查 `.inftest-workspace/task-server-001/` 下执行日志、`case_result.json`、`summary.json`、`analysis/report.md`。
8. CLI 链路成功后，再考虑 HTTP server 和平台入口。

## 未完成进度

- M0 原项目跑通：依赖和 typecheck 已恢复；`bun run dev`、`bun run build`、REPL 登录/对话还未验收。
- M1 Headless QueryEngine：已新增 `InfTestQueryRunner`；还未用真实模型环境确认 `QueryEngine.submitMessage` 可稳定脱离 REPL 工作。
- M2 自定义工具注册：`run_fake_e2e` 已有 query runner 单测覆盖；业务拆分工具还未验证模型在 agent loop 中主动调用。
- M3 Workspace + PlanDAG：workspace/plan 写入能力已实现；还未通过主 Agent 完整生成一次 `plan.json`。
- M4 fake case generation：已由 fake E2E runner 和 HTTP `/task START` 验收通过。
- M5 完整 fake 闭环：已跑通从 START 到 SUCCESS 的端到端闭环。
- M6 InfTest HTTP API：已对齐《InfTest 接口文档》— `/health`、`POST /tasks/alter`、`POST /tasks/terminate`、`GET /tasks/{id}`、`POST /tasks/chat/stream`（统一 `{code,message,data}` 包）；`POST /task` 支持 fake/query runner；`/chat/stream` 目前是明确的 501 占位响应。
- M7 任务控制：已有 `control_task` 状态记录，`TERMINATE` 已可尝试终止运行中子 Agent；真实暂停/继续语义未完成。
- M8 真实子 Agent 替换：已为真实执行 Agent 和报告 Agent 增加适配脚本；真实联调仍等待执行 Agent 机器路径、报告 Agent 路径、真实需求文档和执行结果输出路径确认。测试生成 Agent 仍不可用，当前用主 Agent 静态计划临时代替。

## 最终交付物定义

最终交付物是一套嵌入 CCB 的 InfTest 主 Agent 服务模块，而不是单纯的文档或 demo：

- CCB headless 主 Agent：基于 `QueryEngine.submitMessage`，不依赖 REPL UI。
- InfTest 工具体系：任务读取、workspace 初始化、PlanDAG 写入、子 Agent 调用、结果监听、状态上报、任务控制、产物读写。
- HTTP 服务入口：支持平台通过 `/tasks/alter` 启动任务，通过 `/tasks/chat/stream` 接收流式事件，通过 `/health` 探活。
- 可复现 fake 闭环：无需真实设备/真实子 Agent，也能跑通生成用例、设备调度、执行结果、分析报告、最终状态上报。
- 子 Agent 适配层：fake agent 可替换为真实测试生成、设备调度、执行、结果分析 Agent，主流程不需要大改。
- 验收材料：typecheck/build 通过，端到端运行说明，workspace 产物示例，开发进度文档持续更新。

- M6+：`INFTEST_ORCHESTRATION` aggregate/stepwise；`/tasks/chat/stream` 工具事件字段；Proxy `task_report` 可配置；子 Agent output-json zod 校验。
