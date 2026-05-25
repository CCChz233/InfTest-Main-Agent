# CLAUDE.md

本仓库基于 CCB 改造 InfTest Planner/Reflection 主 Agent。

## 项目定位

这是一个面向测试闭环的主 Agent，不是普通聊天机器人，也不是代码修复 Agent。

主 Agent 负责：

- 接收任务启动、暂停、继续、终止指令；
- 查询任务详情；
- 生成 PlanDAG；
- 调用测试生成、设备调度、测试执行、结果分析等子 Agent；
- 执行 Reflection；
- 上报任务阶段、用例树、用例详情和最终结果；
- 支持用户指令注入。

## 架构规则

- CCB 的 `queryLoop` 只作为 agent/tool 循环，避免写入 InfTest 业务逻辑。
- InfTest 平台入口应调用 `QueryEngine.submitMessage`，不要依赖 `REPL.tsx`。
- 新增 InfTest 代码放在 `src/inftest/` 下。
- 子 Agent 统一通过 `invoke_subagent` 工具调用。
- 不允许模型直接拼任意 shell 命令。
- 不允许直接调用后端 `/tasks/update`。
- 状态回写统一通过代理服务。
- 大输入、大输出必须通过 workspace 文件传递。
- 子 Agent 结果必须写入 `--output-json`。
- stdout/stderr 只作为日志，不作为主结果解析。

## Stage 枚举

只能使用：

- `PLANNING`
- `DATA_GEN`
- `COORDINATE`
- `EXECUTING`
- `REFLECTING`
- `COMPLETED`

## InfTest Tools

第一版只实现这些工具：

- `get_task_detail`
- `init_workspace`
- `write_plan_dag`
- `invoke_subagent`
- `watch_execution_results`
- `report_task_update`
- `control_task`
- `read_artifact`
- `write_artifact`

## 暂时不要改

第一版不要改：

- `queryLoop` 主体逻辑；
- `REPL.tsx` 核心交互；
- `forkedAgent` 主体逻辑；
- swarm backend；
- Pipe IPC；
- LAN；
- Remote Control；
- Computer Use；
- Chrome Use；
- Web Search。

## 开发顺序

1. 验证 CCB 原始项目能运行；
2. 验证 `QueryEngine.submitMessage` 可脱离 REPL 使用；
3. 注册 `get_task_detail` 假工具；
4. 实现 workspace 和 PlanDAG；
5. 实现 `invoke_subagent`；
6. 接 fake 子 Agent；
7. 跑通完整 fake 测试闭环；
8. 新增 HTTP `/task` 和 `/chat/stream`；
9. 替换真实子 Agent。
