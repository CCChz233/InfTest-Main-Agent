# CCB InfTest 开发进度

> 记录日期：2026-05-19

## 2026-05-27 主 Agent 状态机 / Skill / Hook v1

- 已扩展 `TaskSession`，新增：
  - `current_stage`
  - `previous_stage`
  - `active_skill`
  - `blocking_reason`
  - `stage_history`
- 已新增 `InfTestStateMachine`：
  - 覆盖 `START -> PLANNING -> DATA_GEN -> COORDINATE -> EXECUTING -> REFLECTING -> COMPLETED -> SUCCESS`。
  - 覆盖 `PAUSE`、`CONTINUE`、`TERMINATE`、`RESTART`、`FAIL`。
  - 对跳阶段、终态继续推进、非法控制转移做显式校验。
- 已新增 Skill 框架：
  - `SkillRegistry`
  - `InfTestSkill` / `SkillInput` / `SkillResult`
  - `PlanSkill`
  - `StaticCaseGenerationSkill`
  - `DeviceCoordinateSkill`
  - `ExecutionSkill`
  - `ReportSkill`
  - `FinalizeSkill`
- 当前 `DATA_GEN` 继续使用静态用例，不接真实用例生成 Agent。
- `ExecutionSkill` 和 `ReportSkill` 已复用现有真实 CLI adapter：
  - `scripts/inftest_real_execution_agent_adapter.py`
  - `scripts/inftest_real_report_agent_adapter.py`
  - 未使用 `INFTEST_EXECUTION_AGENT_MODE=mock`。
- 已新增 `HookManager`：
  - `onTaskStart`
  - `onEnterStage`
  - `beforeSkillCall`
  - `afterSkillCall`
  - `onSkillError`
  - `onTaskFinish`
- stateful runner 每次运行会落地：
  - `.inftest-workspace/<task_id>/experiment/state_transitions.jsonl`
  - `.inftest-workspace/<task_id>/experiment/skill_invocations.jsonl`
  - `.inftest-workspace/<task_id>/experiment/hooks.jsonl`
  - `.inftest-workspace/<task_id>/experiment/summary.md`
- 已新增 `stateful` runner：
  - `INFTEST_RUNNER=stateful` 可启用。
  - `INFTEST_STATEFUL_RUNNER=1` 可启用。
  - 默认 runner 仍保持 `fake`，`INFTEST_RUNNER=available` 仍走原 available runner。
- 已补充单测：
  - 状态转移 happy path。
  - 非法转移。
  - `SkillRegistry` 注册和重复校验。
  - `HookManager` 实验日志落盘。
  - stateful runner mock skill happy path。
- 未改动 QueryEngine 主循环。
- 未改动 `/api/*` Planner stub 触发语义，stub 仍不触发真实执行链路。

## 2026-05-27 Planner API stub 连通性接口

- 已为智能体代理服务联调新增 Planner 空接口：
  - `POST /api/generate-plan`
  - `POST /api/plan-task-publish`
  - `POST /api/case-publish`
  - `POST /api/task-report-generate`
  - `POST /api/task-manage`
  - `POST /api/user-instruction`
  - 兼容文档旧口径：`POST /api/payload`
- Stub 只做：
  - JSON 解析。
  - 基础字段校验。
  - 请求落盘日志。
  - 返回 `{ code: 0, message: "success", data: ... }`。
- Stub 明确不触发真实执行链路：
  - `/api/task-manage START` 不会调用 `runInfTestFakeE2E`、query runner 或 available runner。
  - `/api/user-instruction` 不会调用模型流式问答。
- 已保留现有真实接口：
  - `POST /tasks/alter`
  - `POST /tasks/terminate`
  - `POST /tasks/chat/stream`
- 所有 stub 请求日志落到：
  - `.inftest-workspace/planner-api-stub/<request_id>.json`
  - 当请求体未带 `request_id` 时由服务自动生成。
- 已新增最小单测：
  - 覆盖所有 stub endpoint 的成功响应和日志文件。
  - 覆盖 `/api/task-manage START` 不创建真实 task session。
  - 覆盖字段校验失败和非法 JSON 仍落日志。

## 2026-05-27 Mock 后端端口 Query 模式联调记录

- 已精读 `/Users/chz/workspace/inftest-runtime/docs/InfTest 接口文档 (1).md` 中和主 Agent 直接相关的部分：
  - 任务管理模块
  - 智能体代理服务 `<->` 智能体
  - Planner `<->` 子 Agent
  - 设备操作交互
- 已明确主 Agent 的直接交互对象：
  - 上游：智能体代理服务调用主 Agent HTTP API。
  - 回调：主 Agent 主动向智能体代理服务上报状态、计划详情、报告文件。
  - 下游：主 Agent 通过 CLI 调用子 Agent。
  - 非直接对象：前端 Web Client、后端云服务、设备云服务、设备终端。
- 已沉淀主 Agent 专用接口文档：
  - `inftest_docs/InfTest_主Agent接口交互专用文档.md`
  - 内容覆盖：交互对象、主 Agent 被调用接口、主 Agent 主动调用接口、子 Agent CLI、Postman 实验步骤、当前差距清单。
- 已将主 Agent 专用接口文档加入 `inftest_docs/README.md`。
- 已按领导口径更新主 Agent 专用接口文档：
  - 主 Agent 的 HTTP 直接交互对象只有智能体代理服务 Agent Service。
  - 后端云服务、前端、设备服务都不直接调用主 Agent。
  - 主 Agent 通过 CLI 调用子 Agent，但这不属于 HTTP 服务交互。
  - 本机 mock 后端对主 Agent 视角应被当作智能体代理服务。
- 已沉淀 Postman 智能体代理服务模拟测试用例：
  - `inftest_docs/InfTest_Postman_智能体代理服务模拟测试用例.md`
  - 只保留 Postman 直接扮演智能体代理服务调用主 Agent 的方式。
  - 覆盖主 Agent 直接 START、任务详情查询、状态回调记录、终止接口冒烟、用户指令注入冒烟。
- 已新增可导入 Postman collection：
  - `postman/InfTest_MainAgent_ProxySimulation.postman_collection.json`
  - 已验证 JSON 格式可解析。
- 已按“只做方式 B”收敛 Postman 实验口径：
  - Postman 直接扮演智能体代理服务调用主 Agent。
  - mock Agent Service 是本机临时模拟的智能体代理服务，只负责提供 task detail、接收 update 和 debug 查询。
  - 不再设计由 mock Agent Service 代发 START 的转发实验。
- 已确认“带 mock 端口、模拟用户从平台发起任务”的正确模式是：
  - `INFTEST_RUNNER=query`
  - `INFTEST_ORCHESTRATION=stepwise`
- 已明确 `available` 模式的定位：
  - 适合验证真实 CLI adapter 接线。
  - 不适合验证主 Agent 模型编排和用户输入后的工具调用过程。
- 已新增 mock 后端 API：
  - `scripts/inftest_mock_backend_api.ts`
  - 支持 `POST /api/tasks/alter`、`GET /api/tasks/detail`、`POST /api/tasks/update`、`POST /api/files/agent/upload`。
  - `START` 请求会转发到 InfTest 主 Agent API 的 `/tasks/alter`。
  - 主 Agent 的 `report_task_update` 会回传到 mock 后端 `/api/tasks/update`。
- 已新增一键端口 E2E：
  - `scripts/inftest_mock_backend_query_e2e.ts`
  - 自动启动 InfTest 主 Agent API 和 mock 后端 API。
  - 自动向 mock 后端发起 `POST /api/tasks/alter START`。
- 已补充 package scripts：
  - `inftest:mock-backend`
  - `inftest:mock-backend-query-e2e`
- 已修正 stepwise query API 返回产物为空的问题：
  - `src/inftest/TaskSessionManager.ts` 在 query 任务结束时从 workspace 自动识别标准产物。
  - 已新增单测覆盖只写文件、不直接返回 artifacts 的 stepwise query 场景。
- 已调整主 Agent START prompt：
  - 避免模型把完整任务 workspace 再传给 `init_workspace` 导致 `.inftest-workspace/<task_id>/<task_id>` 嵌套目录。
- 已验证端口 E2E：
  - 命令：`bun run scripts/inftest_mock_backend_query_e2e.ts --task-id task-port-query-003 --agent-port 18887 --backend-port 18890`
  - 结果：`ok: true`
  - `runner: query`
  - `orchestration: stepwise`
  - `task_status: SUCCESS`
  - `run_fake_e2e_invoked: false`
  - `update_count: 10`
- 已确认成功产物：
  - `.inftest-workspace/task-port-query-003/plan.json`
  - `.inftest-workspace/task-port-query-003/case_generation/test_cases.json`
  - `.inftest-workspace/task-port-query-003/device_scheduling/device_bindings.json`
  - `.inftest-workspace/task-port-query-003/execution/results/summary.json`
  - `.inftest-workspace/task-port-query-003/analysis/report.json`
  - `.inftest-workspace/task-port-query-003/analysis/report.md`
- 已执行验证：
  - `bun test src/inftest/__tests__/TaskSessionManager.test.ts` 通过，6 个测试通过。
  - `bun build scripts/inftest_mock_backend_api.ts --target=bun --outfile=/private/tmp/inftest_mock_backend_api.js` 通过。
  - `bun build scripts/inftest_mock_backend_query_e2e.ts --target=bun --outfile=/private/tmp/inftest_mock_backend_query_e2e.js` 通过。
- 已沉淀文档：
  - `inftest_docs/InfTest_Mock后端端口Query模式联调手册.md`
  - 已更新 `inftest_docs/README.md`
  - 已更新 `inftest_docs/InfTest_API全真模拟联调经验手册.md`
  - 已更新 `inftest_docs/InfTest_API全真模拟测试用例.md`

## 2026-05-26 真实 Agent API 联调记录

- 已进入 `InfTest-Main-Agent` 并阅读：
  - `inftest_docs/README.md`
  - `inftest_docs/InfTest_服务器部署联调手册.md`
- 已确认 `scripts/` 下存在本轮联调所需入口：
  - `inftest_available_agents_e2e.ts`
  - `inftest_task_api.ts`
  - `inftest_real_execution_agent_adapter.py`
  - `inftest_real_report_agent_adapter.py`
- 已初步确认 `src/inftest/server/taskApi.ts` 此前只识别 `INFTEST_RUNNER=query`，未支持 `INFTEST_RUNNER=available`。
- 已补齐 `INFTEST_RUNNER=available`：
  - `src/inftest/schemas/session.ts` 的 runner 枚举新增 `available`
  - `src/inftest/schemas/config.ts` 的 config runner 枚举新增 `available`
  - `src/inftest/TaskSessionManager.ts` 新增 `finishSessionFromAvailableResult`
  - `src/inftest/server/taskApi.ts` 的 `POST /tasks/alter START` 在 `available` 模式下调用 `runInfTestAvailableAgentsE2E`
- 已定位本机真实 Agent 路径：
  - 执行 Agent 仓库：`/Users/chz/workspace/inftest-runtime/gui-tester`
  - 当前执行入口：`/Users/chz/workspace/inftest-runtime/gui-tester/run_API.py`
  - 报告 Agent 仓库：`/Users/chz/workspace/inftest-runtime/inftest-report-agent`
  - 当前报告入口：`/Users/chz/workspace/inftest-runtime/inftest-report-agent/run_report.py`
  - 需求文档：`/Users/chz/workspace/inftest-runtime/docs/Kongming（孔明）—— AI 原生质量OS (1).docx`
- 已确认执行 Agent 本机代码与旧文档存在差异：
  - 旧文档命令是 `python run_API.py execute --device-case-bind ...`
  - 当前 `gui-tester/run_API.py` 实际参数是 `--case/--json/--customer/--doc/--output`
  - 当前执行入口需要 `front/api_server.py` 提供 `/api/run-testcase-file`
- 已做 CLI 帮助探测：
  - `python3 run_API.py --help` 通过
  - `python3 run_report.py --help` 通过
  - `python3 front/api_server.py` 因缺少 `flask` 失败，当前本机尚不能启动 `gui-tester` API server
- 已创建本地 Python 3.13 虚拟环境：
  - 路径：`/Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.venv-inftest-py313`
  - 原因：系统 `python3` 是 3.14，部分 `gui-tester` 依赖尚不兼容 3.14
  - 已用 Python 3.13 成功安装 `gui-tester` 和 `inftest-report-agent` 的 requirements
- 已处理 `gui-tester` 启动依赖兼容问题：
  - 补装 `mobilerun`
  - 在 `gui-tester/droidrun/droidrun/tools/driver/cloud.py` 为 `mobilerun_sdk.AsyncMobilerun` 增加导入兜底
- 已启动 `gui-tester` API server：
  - 端口：`5001`
  - 需要在调用 `run_API.py` 时设置 `API_PORT=5001`
- 已单独运行当前 `gui-tester` 原始执行命令：
  - 命令形态：`python run_API.py --case <case.md> --json <case_result.json>`
  - 当前返回 `400`：`未检测到可用测试设备，请先连接设备`
  - 因设备不可用，尚未生成 `case_result.json`
- 已修正 `gui-tester/front/api_server.py` 的 Markdown 用例解析解包问题。
- 已让 `scripts/inftest_real_execution_agent_adapter.py` 兼容当前 `run_API.py --case/--json` 入口：
  - 自动从 `device_case_bind.json` 生成 `execution/inputs/test_cases.md`
  - 调用当前 `gui-tester` 的 `/api/run-testcase-file` CLI 包装入口
  - `summary.json` 支持从 list 格式或 `{cases: [...]}` 格式生成
- 已单独运行报告 Agent 原始命令：
  - 命令形态：`python run_report.py --customer 新华 --project-id xh --log-file <case_result.json> --doc <requirements.docx> --output <output>`
  - 已确认能读取需求文档并从 `case_result.json` 推导用例
  - 首次失败原因：报告 Agent 代码只识别 `attribution/reason` 预归因字段，不识别文档里的顶层 `functional`
  - 已在 `inftest-report-agent/services/log_parsing.py` 增加顶层 `functional` 兼容分支
  - 再次运行进入真实报告生成流程，但本机没有 `http://127.0.0.1:8000/v1` 模型服务，最终失败：`模型调用失败：Connection error.`
- 已运行 `AvailableAgentsRunner` CLI E2E：
  - task id：`task-local-real-001`
  - 已生成 `plan.json`、`case_generation/test_cases.json`、`device_scheduling/device_case_bind.json`
  - 已通过 CLI 调用真实 `gui-tester/run_API.py --case ... --json ...`
  - 当前失败点：执行 Agent 返回 `未检测到可用测试设备，请先连接设备`
  - 因没有可用设备，未生成 `execution/results/case_result.json` 和 `summary.json`，后续报告阶段未开始
  - 关键日志：
    - `.inftest-workspace/task-local-real-001/execution/logs/real_execution_agent_invocation.json`
    - `.inftest-workspace/task-local-real-001/execution/logs/real_execution_agent.stdout.log`
    - `.inftest-workspace/task-local-real-001/execution/result.json`
- 已执行 `bun install` 修复主仓 JS 依赖缺失问题；此前 API 启动失败原因是本地 Bun 依赖缺少 `@opentelemetry/api`。
- HTTP API 验证尚未完成：
  - 准备使用 `INFTEST_RUNNER=available` 启动 `scripts/inftest_task_api.ts`
  - 本轮 Codex 端口权限申请被系统拒绝，无法继续启动 `127.0.0.1:8787`
  - 需要在本机终端或有端口权限的环境中继续执行 `POST /tasks/alter START`
- 已运行 `bun run typecheck`，当前失败在既有 `packages/builtin-tools/src/tools/WebFetchTool/utils.ts` 的 Axios header 类型不兼容，和本轮 InfTest available runner 改动无直接关系。

### 2026-05-26 续：联调复验（调用链已接通，环境资源仍阻塞 SUCCESS）

- 已复验 `scripts/` 下 4 个入口均存在：
  - `inftest_available_agents_e2e.ts`
  - `inftest_task_api.ts`
  - `inftest_real_execution_agent_adapter.py`
  - `inftest_real_report_agent_adapter.py`
- 已复验 `INFTEST_RUNNER=available` 已接入 HTTP `POST /tasks/alter START`：
  - `src/inftest/server/taskApi.ts` 在 `available` 模式调用 `runInfTestAvailableAgentsE2E`
  - `GET /tasks/{id}` 返回 `runner: "available"`
- 已配置并导出真实 Agent 环境变量（本机路径）：
  - `INFTEST_EXECUTION_AGENT_CWD=/Users/chz/workspace/inftest-runtime/gui-tester`
  - `INFTEST_REPORT_AGENT_CWD=/Users/chz/workspace/inftest-runtime/inftest-report-agent`
  - `INFTEST_REQUIREMENT_DOC=/Users/chz/workspace/inftest-runtime/docs/Kongming（孔明）—— AI 原生质量OS (1).docx`
  - `INFTEST_EXECUTION_AGENT_PYTHON` / `INFTEST_REPORT_AGENT_PYTHON` 指向 `.venv-inftest-py313/bin/python`
  - `API_PORT=5001`（与 `gui-tester/run_API.py` 默认 5000 不同，需显式设置）
- 已启动 `gui-tester` API server（`front/api_server.py`，端口 `5001`）。
- 已单独复跑执行 Agent 原始命令：
  - `python run_API.py --case <test_cases.md> --json <case_result.json>`
  - 已打到 `http://127.0.0.1:5001/api/run-testcase-file`
  - 仍返回 `400`：`未检测到可用测试设备，请先连接设备`
  - `adb devices` 当前为空，未生成 `case_result.json`
- 已单独复跑报告 Agent 原始命令（使用 `.inftest-workspace/raw-report/case_result.json`）：
  - 已读入需求 docx 并推导 1 个用例，进入 LLM 报告生成
  - 仍失败：`模型调用失败：Connection error.`（本机无 `http://127.0.0.1:8000/v1` 服务）
- 已复跑 `AvailableAgentsRunner` CLI E2E：
  - task id：`task-local-real-002`
  - 已生成 `plan.json`、`device_case_bind.json`，并真实 CLI 调 `gui-tester/run_API.py`
  - 失败点：`invoke_subagent:test_executor` → `CASE_RESULT_NOT_FOUND`（同上，无可用设备）
- 已启动 HTTP API 并完成 `POST /tasks/alter START` 验证：
  - 启动：`INFTEST_RUNNER=available INFTEST_CONFIG=.inftest/config.available-agents.example.json bun run scripts/inftest_task_api.ts`
  - 监听：`http://127.0.0.1:8787`
  - `GET /health` → `code: 0`
  - `POST /tasks/alter START` task id：`task-api-real-001`
  - 返回：`code: 500`，`message: test_executor failed: Sub agent exited with code 1`
  - `GET /tasks/task-api-real-001` → `runner: "available"`，`task_status: "FAILED"`
  - 已生成产物：`plan.json`、`device_scheduling/device_case_bind.json`
  - 未生成：`execution/results/case_result.json`、`summary.json`、`analysis/report.md`
  - 关键日志：
    - `.inftest-workspace/task-api-real-001/execution/logs/real_execution_agent_invocation.json`
    - `.inftest-workspace/task-api-real-001/execution/logs/real_execution_agent.stdout.log`
    - `.inftest-workspace/task-api-real-001/execution/result.json`
- **结论**：HTTP 入口 → 主 Agent → 真实 CLI 执行 Agent 的调用链已跑通；当前距 SUCCESS 仅差两类环境资源：
  1. 连接可用测试设备（adb / hdc / ios），使 `gui-tester` 能写出 `case_result.json`
  2. 启动报告 Agent 所需 LLM 服务（默认 `inftest-report-agent/.env` 中 `BASE_URL=http://127.0.0.1:8000/v1`）

### 2026-05-26 续：执行 Agent mock 产物开关

- 为解除本机无测试设备导致的联调阻塞，已在 `scripts/inftest_real_execution_agent_adapter.py` 增加执行结果 mock 模式：
  - 开关：`INFTEST_EXECUTION_AGENT_MODE=mock`
  - 兼容开关：`INFTEST_EXECUTION_MOCK=true`
  - 该模式仍走 `AvailableAgentsRunner -> SubAgentAdapter -> inftest_real_execution_agent_adapter.py`
  - adapter 不调用 `gui-tester/run_API.py`，直接根据 `device_case_bind.json` 生成标准产物：
    - `execution/results/case_result.json`
    - `execution/results/summary.json`
    - `execution/logs/real_execution_agent_invocation.json`
    - `execution/logs/real_execution_agent.stdout.log`
    - `execution/logs/real_execution_agent.stderr.log`
- 已执行语法检查：`.venv-inftest-py313/bin/python -m py_compile scripts/inftest_real_execution_agent_adapter.py` 通过。
- 注意：该开关只 mock 执行 Agent 数据，不 mock 报告 Agent；如果本机仍未启动 `http://127.0.0.1:8000/v1` 模型服务，链路会继续卡在真实报告 Agent。
- 已新增本地 OpenAI 兼容模型 stub：
  - 文件：`scripts/inftest_mock_openai_server.py`
  - 默认监听：`http://127.0.0.1:8000/v1`
  - 用途：仅用于本机无真实模型服务时，让真实 `inftest-report-agent/run_report.py` 完成报告生成联调
  - 已执行语法检查：`.venv-inftest-py313/bin/python -m py_compile scripts/inftest_mock_openai_server.py scripts/inftest_real_execution_agent_adapter.py scripts/inftest_real_report_agent_adapter.py` 通过
- 已启动本地模型 stub 并复跑 `AvailableAgentsRunner` CLI E2E：
  - task id：`task-local-exec-mock-003`
  - 环境：`INFTEST_EXECUTION_AGENT_MODE=mock`
  - 结果：`status: SUCCESS`
  - 已生成：
    - `.inftest-workspace/task-local-exec-mock-003/plan.json`
    - `.inftest-workspace/task-local-exec-mock-003/device_scheduling/device_case_bind.json`
    - `.inftest-workspace/task-local-exec-mock-003/execution/results/case_result.json`
    - `.inftest-workspace/task-local-exec-mock-003/execution/results/summary.json`
    - `.inftest-workspace/task-local-exec-mock-003/analysis/report.md`
- 已启动 HTTP API 并完成 available runner + 执行 Agent mock 的 API 闭环：
  - API：`http://127.0.0.1:8787`
  - 请求：`POST /tasks/alter`，task id：`task-api-real-001`
  - 返回：`code: 0`，`runner: "available"`，`task_status: "SUCCESS"`
  - `GET /tasks/task-api-real-001` 返回 `task_status: "SUCCESS"`，`last_error: null`
  - 已确认成功标准产物存在：
    - `.inftest-workspace/task-api-real-001/plan.json`
    - `.inftest-workspace/task-api-real-001/device_scheduling/device_case_bind.json`
    - `.inftest-workspace/task-api-real-001/execution/results/case_result.json`
    - `.inftest-workspace/task-api-real-001/execution/results/summary.json`
    - `.inftest-workspace/task-api-real-001/analysis/report.md`
- 当前链路说明：
  - HTTP API、InfTest 主 Agent、AvailableAgentsRunner、SubAgentAdapter、报告 Agent CLI 均真实运行
  - 执行 Agent 因本机无可用测试设备，当前通过 `INFTEST_EXECUTION_AGENT_MODE=mock` 写入 mock 执行产物
  - 模型服务因本机无真实 `127.0.0.1:8000/v1`，当前通过 `scripts/inftest_mock_openai_server.py` 提供 OpenAI 兼容 stub
- 已沉淀本轮联调经验文档：
  - `inftest_docs/InfTest_API全真模拟联调经验手册.md`
  - 内容覆盖：联调边界、本机路径、执行 Agent mock、报告 Agent CLI、本地模型 stub、CLI/API 复现命令、产物、日志、常见问题、从 mock 切回真执行
- 已将经验手册加入 `inftest_docs/README.md` 文档索引。
- 已沉淀当前全真模拟测试用例文档：
  - `inftest_docs/InfTest_API全真模拟测试用例.md`
  - 当前静态用例：掌上新华 APP 首页搜索，输入“健康”关键词并验证搜索结果列表
  - 内容覆盖：用例步骤、预期结果、测试计划产物、`device_case_bind.json`、执行 Agent Markdown 输入、mock `case_result.json` / `summary.json`、报告 Agent 输入要求、复用命令
- 已将测试用例文档加入 `inftest_docs/README.md` 文档索引。

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

## 2026-05-27 全真 HTTP + 真实 CLI 联调复盘

本轮已纠正前一轮 `query/stepwise + mock 子 Agent` 的误判，改为按全真链路验证：

```text
HTTP POST /tasks/alter START
  -> INFTEST_RUNNER=available
  -> AvailableAgentsRunner
  -> 真实 gui-tester/run_API.py
  -> 真实 gui-tester/front/api_server.py /api/run-testcase-file
  -> 真实 inftest-report-agent/run_report.py
```

已确认：

- `scripts/inftest_available_agents_e2e.ts` 存在。
- `scripts/inftest_task_api.ts` 存在。
- `scripts/inftest_real_execution_agent_adapter.py` 存在。
- `scripts/inftest_real_report_agent_adapter.py` 存在。
- `POST /tasks/alter START` 已支持 `INFTEST_RUNNER=available`，会进入 `AvailableAgentsRunner`。
- 本机真实路径：
  - 执行 Agent CWD：`/Users/chz/workspace/inftest-runtime/gui-tester`
  - 执行入口：`run_API.py`
  - gui-tester API：`front/api_server.py`
  - 报告 Agent CWD：`/Users/chz/workspace/inftest-runtime/inftest-report-agent`
  - 报告入口：`run_report.py`
  - 需求文档：`/Users/chz/workspace/inftest-runtime/docs/Kongming（孔明）—— AI 原生质量OS (1).docx`

实测命令与结果：

- 已用 Python 3.13 环境启动真实 gui-tester API，端口 `5001`，`GET /api/health` 返回正常。
- 已单独调用真实执行 Agent 原始命令：

```bash
API_PORT=5001 \
/Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.venv-inftest-py313/bin/python \
run_API.py \
  --case /Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.inftest-workspace/task-real-probe/execution/inputs/test_cases.md \
  --json /Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.inftest-workspace/task-real-probe/execution/results/case_result.json
```

真实返回：

```text
HTTP 400: 未检测到可用测试设备，请先连接设备
```

因此执行 Agent 当前没有生成 `case_result.json`。这不是主 Agent 或 runner 入口问题，而是全真执行依赖缺失：当前本机没有可用 Android/HarmonyOS/iOS 测试设备。

设备检查结果：

- `adb` 存在：`/opt/homebrew/bin/adb`
- 沙箱外执行 `adb devices` 成功，但设备列表为空。
- `hdc` 不存在。
- `idevice_id` 不存在。

报告 Agent 单独验证结果：

- 已用真实 `inftest-report-agent/run_report.py` 读取已有结构化 `case_result.json` 和真实需求文档。
- 报告 Agent 能启动并进入报告生成阶段。
- 当前失败点是模型服务连接失败。
- `inftest-report-agent/.env` 当前指向：

```text
BASE_URL=http://127.0.0.1:8000/v1
MODEL=autoglm-phone-9b
API_KEY=已配置
```

- 实测 `http://127.0.0.1:8000/v1/models` 连接失败，说明本机 8000 端口没有模型服务。

已修复的主 Agent 适配问题：

- `gui-tester/run_API.py` 在 HTTP 400 时仍以进程退出码 0 结束，之前主 Agent 只能报 `CASE_RESULT_NOT_FOUND`。
- 已增强 `scripts/inftest_real_execution_agent_adapter.py`：解析 `run_API.py` stdout 中的 `状态码` 和 `返回结果`，当返回 `success=false` 或 HTTP 4xx/5xx 时写入结构化错误 `EXECUTION_AGENT_API_FAILED`。
- 已增强 `src/inftest/adapters/SubAgentAdapter.ts`：当子 Agent 已写入结构化 `output_json.error.message` 时，API 优先返回该真实错误，而不是只返回“子进程退出码 1”。
- 相关验证：

```bash
/Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.venv-inftest-py313/bin/python -m py_compile scripts/inftest_real_execution_agent_adapter.py
bun test src/inftest/__tests__/TaskSessionManager.test.ts src/inftest/__tests__/loadInfTestConfig.test.ts
```

通过最新主 Agent available HTTP 入口实测：

```bash
POST http://127.0.0.1:8789/tasks/alter
{"task_id":"task-api-real-http-003","task_operation":"START"}
```

返回：

```json
{
  "code": 500,
  "message": "test_executor failed: Execution API returned HTTP 400: 未检测到可用测试设备，请先连接设备"
}
```

落地产物：

```text
.inftest-workspace/task-api-real-http-003/plan.json
.inftest-workspace/task-api-real-http-003/case_generation/test_cases.json
.inftest-workspace/task-api-real-http-003/device_scheduling/device_case_bind.json
.inftest-workspace/task-api-real-http-003/execution/inputs/test_cases.md
.inftest-workspace/task-api-real-http-003/execution/result.json
.inftest-workspace/task-api-real-http-003/execution/logs/real_execution_agent_invocation.json
.inftest-workspace/task-api-real-http-003/execution/logs/real_execution_agent.stdout.log
.inftest-workspace/task-api-real-http-003/execution/logs/real_execution_agent.stderr.log
```

当前全真联调准确卡点：

1. 执行 Agent 卡在真实设备检测：当前没有可用测试设备，所以无法产出真实 `case_result.json` / `summary.json`。
2. 报告 Agent 卡在真实模型服务：`http://127.0.0.1:8000/v1` 当前没有服务，所以无法生成真实报告。

下一步必须先补齐真实依赖：

1. 连接一台可被 gui-tester 识别的 Android 设备，或安装/配置 HarmonyOS `hdc`，或安装/配置 iOS `idevice_id` + WDA。
2. 启动真实 OpenAI-compatible 模型服务，确保 `GET /v1/models` 和 `POST /v1/chat/completions` 可访问，或更新 `inftest-report-agent/.env` 指向可用模型网关。
3. 重新运行 `INFTEST_RUNNER=available` 的 `/tasks/alter START`。
4. 预期设备和模型都可用后，才会继续产出：
   - `execution/results/case_result.json`
   - `execution/results/summary.json`
   - `analysis/report.md`

## 2026-05-27 续：只模拟设备层的真实链路联调

用户确认暂时没有真实设备，本轮改为只模拟设备层，其他链路尽量保持真实。

已新增 `gui-tester` 设备层 mock 开关：

```text
INFTEST_MOCK_DEVICE=1
```

修改位置：

```text
/Users/chz/workspace/inftest-runtime/gui-tester/front/api_server.py
```

实现口径：

- 不启用 `INFTEST_EXECUTION_AGENT_MODE=mock`，避免绕过执行 Agent。
- 仍由主 Agent 通过 `SubAgentAdapter` CLI 调用真实 `gui-tester/run_API.py`。
- `run_API.py` 仍真实请求 `gui-tester/front/api_server.py` 的 `/api/run-testcase-file`。
- 仅在 `gui-tester` 设备发现为空时返回 mock device：

```json
{
  "device_id": "mock-device-001",
  "device_name": "InfTest Mock Device",
  "device_type": "adb",
  "connection_type": "MOCK"
}
```

- 单用例执行在 mock device 下返回成功，并写出报告 Agent 可解析的结构化 `case_result.json`。
- mock device 产物补齐 `functional` 预归因字段，避免真实报告 Agent 因“缺少预归因数据”提前失败。

已单独验证真实执行 Agent 原始命令：

```bash
API_PORT=5002 \
/Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.venv-inftest-py313/bin/python \
run_API.py \
  --case /Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.inftest-workspace/task-device-mock-probe-002/execution/inputs/test_cases.md \
  --json /Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.inftest-workspace/task-device-mock-probe-002/execution/results/case_result.json
```

结果：

- `run_API.py` 返回 HTTP 200。
- `.inftest-workspace/task-device-mock-probe-002/execution/results/case_result.json` 已生成。
- 产物中包含 `functional.status=passed`。

已通过主 Agent HTTP 入口验证：

```bash
POST http://127.0.0.1:8792/tasks/alter
{"task_id":"task-api-device-mock-002","task_operation":"START"}
```

执行阶段结果：

- 真实生成：
  - `.inftest-workspace/task-api-device-mock-002/plan.json`
  - `.inftest-workspace/task-api-device-mock-002/device_scheduling/device_case_bind.json`
  - `.inftest-workspace/task-api-device-mock-002/execution/inputs/test_cases.md`
  - `.inftest-workspace/task-api-device-mock-002/execution/results/case_result.json`
  - `.inftest-workspace/task-api-device-mock-002/execution/results/summary.json`
- `execution/result.json` 中 `success=true`
- `summary.json` 中 `total=1`、`passed=1`、`status=SUCCESS`

报告阶段结果：

- 已进入真实 `inftest-report-agent/run_report.py`。
- 已读取需求文档和 `case_result.json`。
- 已完成用例数据处理和缺陷汇总。
- 当前失败点变成真实模型 API：

```text
result_analyzer failed: Report agent exited with code 1. 错误: 模型调用失败：Connection error.
```

因此当前链路准确状态：

```text
设备问题已通过设备层 mock 临时解除。
主 Agent -> 真实执行 Agent -> case_result/summary 已跑通。
剩余阻塞只剩真实报告 Agent 的模型 API 未启动或不可达。
```

已增强 `scripts/inftest_real_report_agent_adapter.py`：

- 当报告 Agent 退出非 0 时，将 stdout/stderr 尾部写入 `analysis/result.json` 的错误消息。
- API 返回现在能直接看到 `模型调用失败：Connection error.`，不用再手动翻日志才能定位。

已执行验证：

```bash
/Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.venv-inftest-py313/bin/python -m py_compile \
  scripts/inftest_real_execution_agent_adapter.py \
  scripts/inftest_real_report_agent_adapter.py

bun test src/inftest/__tests__/TaskSessionManager.test.ts src/inftest/__tests__/loadInfTestConfig.test.ts
```

验证通过。

## 2026-05-27 续：主 Agent 状态机 / Skill / Hook 目标设计落地

已将后续开发目标落成设计文档：

```text
inftest_docs/InfTest_主Agent状态机SkillHook设计.md
```

文档明确当前方向：

```text
StateMachine controls workflow
Skill executes business capability
Adapter calls real sub Agent CLI
Hook records / validates / reports side effects
```

核心结论：

- 主 Agent 不应长期停留在脚本式 `AvailableAgentsRunner`。
- 目标是用显式状态机驱动：
  - `PLANNING`
  - `DATA_GEN`
  - `COORDINATE`
  - `EXECUTING`
  - `REFLECTING`
  - `COMPLETED`
- 每个状态对应一个 skill：
  - plan skill
  - case generation skill
  - device coordinate skill
  - execution skill
  - report skill
  - finalize skill
- hooks 只做日志、校验、上报、错误落盘，不决定主流程。
- 用户 prompt 注入应作为 `USER_INSTRUCTION_RECEIVED` 事件处理：
  - 控制类：暂停、继续、终止、重跑
  - 业务类：进入 instruction queue，在 safe point 生效
  - 问答类：只读 session/artifacts/logs，不改变状态

文档也记录了当前代码缺口：

- `TaskSession.current_stage` 未持久化。
- 没有显式 `InfTestStateMachine`。
- 没有 `SkillRegistry`。
- 没有 `HookManager`。
- 没有 `instruction_queue`。
- 没有完整非法状态转移校验。
- `/tasks/chat/stream` 当前只是问答式响应，不会改变执行链路。

已同步更新：

```text
inftest_docs/README.md
```

## 2026-05-28 上服务器前整体检查

本轮目标：确认 InfTest 主 Agent 当前代码可以上传服务器进入联调。不新增大功能，不重构，不删除 fake E2E，不改 QueryEngine 主循环，不把子 Agent 合并进主 Agent。

### Git 状态

本轮与 InfTest 主 Agent 上线检查相关的改动集中在：

- Planner `/api/*` stub：
  - `src/inftest/server/plannerApiStub.ts`
  - `src/inftest/server/taskApi.ts`
  - `src/inftest/server/apiResponse.ts`
  - `src/inftest/schemas/api.ts`
  - `src/inftest/__tests__/plannerApiStub.test.ts`
- `stateful` runner、状态机、Skill、Hook：
  - `src/inftest/InfTestStateMachine.ts`
  - `src/inftest/StatefulRunner.ts`
  - `src/inftest/HookManager.ts`
  - `src/inftest/skills/*`
  - `src/inftest/schemas/session.ts`
  - `src/inftest/TaskSessionManager.ts`
  - 对应单测
- 真实 CLI adapter 增强：
  - `scripts/inftest_real_execution_agent_adapter.py`
  - `scripts/inftest_real_report_agent_adapter.py`
  - `src/inftest/adapters/SubAgentAdapter.ts`
- 联调文档和 Postman 资料：
  - `inftest_docs/README.md`
  - `inftest_docs/InfTest_主Agent接口交互专用文档.md`
  - `inftest_docs/InfTest_主Agent状态机SkillHook设计.md`
  - `inftest_docs/InfTest_API全真模拟联调经验手册.md`
  - `inftest_docs/InfTest_API全真模拟测试用例.md`
  - `inftest_docs/InfTest_Mock后端端口Query模式联调手册.md`
  - `inftest_docs/InfTest_Postman_智能体代理服务模拟测试用例.md`
  - `postman/InfTest_MainAgent_ProxySimulation.postman_collection.json`

当前仍存在不相关脏文件，判断为误落在仓库根目录的运行产物，未在本轮处理：

```text
analysis/
case_generation/
device_scheduling/
execution/
```

### 测试与构建

已执行：

```bash
bun test src/inftest/__tests__
bun build scripts/inftest_task_api.ts --target=bun --outfile=/private/tmp/inftest_task_api.js
.venv-inftest-py313/bin/python -m py_compile \
  scripts/inftest_real_execution_agent_adapter.py \
  scripts/inftest_real_report_agent_adapter.py \
  scripts/inftest_mock_openai_server.py
bunx biome check \
  src/inftest/HookManager.ts \
  src/inftest/InfTestStateMachine.ts \
  src/inftest/StatefulRunner.ts \
  src/inftest/server/plannerApiStub.ts \
  src/inftest/skills/* \
  src/inftest/__tests__/HookManager.test.ts \
  src/inftest/__tests__/InfTestStateMachine.test.ts \
  src/inftest/__tests__/SkillRegistry.test.ts \
  src/inftest/__tests__/StatefulRunner.test.ts \
  src/inftest/__tests__/plannerApiStub.test.ts
```

结果：

- `bun test src/inftest/__tests__` 通过：39 pass，0 fail。
- `bun build scripts/inftest_task_api.ts --target=bun --outfile=/private/tmp/inftest_task_api.js` 通过。
- Python adapter `py_compile` 通过。
- 本轮核心新增文件的局部 `biome check` 通过。
- 较宽范围 `bunx biome check src/inftest ...` 会报若干既有格式差异，未发现本轮核心新增文件问题。
- `bun run typecheck` 仍失败在既有问题：
  - `packages/builtin-tools/src/tools/WebFetchTool/utils.ts:442`
  - `packages/builtin-tools/src/tools/WebFetchTool/utils.ts:444`
  - `packages/builtin-tools/src/tools/WebFetchTool/utils.ts:456`
  - `packages/builtin-tools/src/tools/WebFetchTool/utils.ts:475`
  - 原因仍是 Axios header 值类型包含 `number | boolean | string[] | AxiosHeaders`，未收窄到 `string`。该问题和 InfTest 主 Agent 改动无关。

### Planner API stub 验证

启动主 Agent 后已验证以下接口均返回 `code=0`：

```text
POST /api/generate-plan
POST /api/plan-task-publish
POST /api/case-publish
POST /api/task-report-generate
POST /api/task-manage
POST /api/user-instruction
POST /api/payload
```

请求日志已落到：

```text
.inftest-workspace/planner-api-stub/
```

本轮请求日志文件：

```text
preflight-generate-plan.json
preflight-plan-task-publish.json
preflight-case-publish.json
preflight-task-report-generate.json
preflight-task-manage.json
preflight-user-instruction.json
preflight-payload.json
```

已额外确认 `/api/task-manage START` 仍只是 stub，不会创建真实 task session。

### Stateful runner 验证

启动设备层 mock：

```bash
cd /Users/chz/workspace/inftest-runtime/gui-tester
API_PORT=5002 \
INFTEST_MOCK_DEVICE=1 \
/Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.venv-inftest-py313/bin/python \
front/api_server.py
```

启动主 Agent：

```bash
cd /Users/chz/workspace/inftest-runtime/InfTest-Main-Agent
INFTEST_RUNNER=stateful \
INFTEST_CONFIG=.inftest/config.available-agents.example.json \
API_PORT=5002 \
INFTEST_EXECUTION_AGENT_CWD=/Users/chz/workspace/inftest-runtime/gui-tester \
INFTEST_EXECUTION_AGENT_PYTHON=/Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.venv-inftest-py313/bin/python \
INFTEST_REPORT_AGENT_CWD=/Users/chz/workspace/inftest-runtime/inftest-report-agent \
INFTEST_REPORT_AGENT_PYTHON=/Users/chz/workspace/inftest-runtime/InfTest-Main-Agent/.venv-inftest-py313/bin/python \
INFTEST_REQUIREMENT_DOC='/Users/chz/workspace/inftest-runtime/docs/Kongming（孔明）—— AI 原生质量OS (1).docx' \
bun run scripts/inftest_task_api.ts
```

调用：

```bash
POST /tasks/alter
{"task_id":"task-preflight-stateful-001","task_operation":"START"}
```

结果：

- API 返回 `code=500`。
- `GET /tasks/task-preflight-stateful-001` 显示：
  - `runner: "stateful"`
  - `task_status: "FAILED"`
  - `current_stage: "REFLECTING"`
  - `run_fake_e2e_invoked: false`
- 真实执行 Agent CLI 已被调用：
  - `gui-tester/run_API.py --case ... --json ...`
  - 请求地址为 `http://127.0.0.1:5002/api/run-testcase-file`
  - 返回状态码 `200`
  - 设备为 `INFTEST_MOCK_DEVICE=1` 下的 `mock-device-001`
- 执行阶段成功产出：
  - `.inftest-workspace/task-preflight-stateful-001/plan.json`
  - `.inftest-workspace/task-preflight-stateful-001/device_scheduling/device_case_bind.json`
  - `.inftest-workspace/task-preflight-stateful-001/device_scheduling/device_bindings.json`
  - `.inftest-workspace/task-preflight-stateful-001/execution/results/case_result.json`
  - `.inftest-workspace/task-preflight-stateful-001/execution/results/summary.json`
- 实验轨迹已产出：
  - `.inftest-workspace/task-preflight-stateful-001/experiment/state_transitions.jsonl`
  - `.inftest-workspace/task-preflight-stateful-001/experiment/skill_invocations.jsonl`
  - `.inftest-workspace/task-preflight-stateful-001/experiment/hooks.jsonl`
  - `.inftest-workspace/task-preflight-stateful-001/experiment/summary.md`

失败点确认：

```text
Report agent exited with code 1. 错误: 模型调用失败：Connection error.
```

报告 Agent 已真实启动并读取到 `case_result.json` 与需求文档，失败只发生在模型 API 连接阶段。本机 `inftest-report-agent/.env` 当前仍指向：

```text
BASE_URL=http://127.0.0.1:8000/v1
MODEL=autoglm-phone-9b
```

### Available runner 对照

同样环境下启动：

```bash
INFTEST_RUNNER=available
```

调用：

```bash
POST /tasks/alter
{"task_id":"task-preflight-available-001","task_operation":"START"}
```

结果：

- API 返回 `code=500`。
- `GET /tasks/task-preflight-available-001` 显示：
  - `runner: "available"`
  - `task_status: "FAILED"`
  - `run_fake_e2e_invoked: false`
- 执行阶段同样成功：
  - `.inftest-workspace/task-preflight-available-001/plan.json`
  - `.inftest-workspace/task-preflight-available-001/device_scheduling/device_case_bind.json`
  - `.inftest-workspace/task-preflight-available-001/device_scheduling/device_bindings.json`
  - `.inftest-workspace/task-preflight-available-001/execution/results/case_result.json`
  - `.inftest-workspace/task-preflight-available-001/execution/results/summary.json`
- 失败点同样是报告 Agent 模型 API：

```text
result_analyzer failed: Report agent exited with code 1. 错误: 模型调用失败：Connection error.
```

结论：`stateful` 和 `available` 的真实执行阶段产物一致，当前共同失败点一致，均不是主 Agent、runner 或执行 Agent CLI 接线问题。

### 服务器部署命令

服务器上主 Agent 建议第一条启动命令如下，实际路径按服务器替换：

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

如服务器暂无真实设备，只允许在 `gui-tester` 服务层启用：

```bash
INFTEST_MOCK_DEVICE=1
```

不要设置：

```bash
INFTEST_EXECUTION_AGENT_MODE=mock
```

### 上线前结论

当前主 Agent 可以上传服务器进入联调，理由：

- Planner `/api/*` stub 均可返回 `code=0` 并落日志。
- `INFTEST_RUNNER=stateful` 已能走状态机、Skill、Hook，并落实验轨迹。
- `stateful` 已真实 CLI 调用 `gui-tester/run_API.py`，在设备层 mock 下能生成 `case_result.json` 和 `summary.json`。
- `available` 对照链路与 `stateful` 执行产物一致。
- fake E2E 保留，QueryEngine 主循环未改，Planner stub 未被替换。

上传服务器前必须补齐：

1. 服务器真实路径：
   - `INFTEST_EXECUTION_AGENT_CWD`
   - `INFTEST_EXECUTION_AGENT_PYTHON`
   - `INFTEST_REPORT_AGENT_CWD`
   - `INFTEST_REPORT_AGENT_PYTHON`
   - `INFTEST_REQUIREMENT_DOC`
2. `gui-tester/front/api_server.py` 必须先启动，并确认 `API_PORT` 可访问。
3. 报告 Agent 模型服务必须可访问，或更新 `inftest-report-agent/.env` 指向可用 OpenAI-compatible 模型网关。
4. 如不使用设备 mock，则需要真实 Android/HarmonyOS/iOS 设备可被 `gui-tester` 识别。

给代理服务的主 Agent base URL：

```text
http://<server-host>:8787
```

当前仍是 stub 的能力：

- `POST /api/generate-plan`
- `POST /api/plan-task-publish`
- `POST /api/case-publish`
- `POST /api/task-report-generate`
- `POST /api/task-manage`
- `POST /api/user-instruction`
- `POST /api/payload`
- 静态用例生成仍替代真实用例生成 Agent。
- 设备调度仍是本地静态绑定。

当前真实 CLI 能力：

- 执行 Agent：`gui-tester/run_API.py`
- 报告 Agent：`inftest-report-agent/run_report.py`

当前最可能失败点：

- 第一优先：报告 Agent 模型 API `Connection error`。
- 第二优先：服务器 `API_PORT` 未指向正在运行的 `gui-tester/front/api_server.py`。
- 第三优先：真实设备不可用，或不允许使用 `INFTEST_MOCK_DEVICE=1` 时无法产出 `case_result.json`。
- 第四优先：服务器 Python 环境缺依赖。

失败时优先看：

```text
.inftest-workspace/<task_id>/execution/result.json
.inftest-workspace/<task_id>/execution/logs/real_execution_agent_invocation.json
.inftest-workspace/<task_id>/execution/logs/real_execution_agent.stdout.log
.inftest-workspace/<task_id>/execution/logs/real_execution_agent.stderr.log
.inftest-workspace/<task_id>/analysis/result.json
.inftest-workspace/<task_id>/analysis/logs/real_report_agent_invocation.json
.inftest-workspace/<task_id>/analysis/logs/real_report_agent.stdout.log
.inftest-workspace/<task_id>/analysis/logs/real_report_agent.stderr.log
.inftest-workspace/<task_id>/experiment/state_transitions.jsonl
.inftest-workspace/<task_id>/experiment/skill_invocations.jsonl
.inftest-workspace/<task_id>/experiment/hooks.jsonl
.inftest-workspace/planner-api-stub/
```
