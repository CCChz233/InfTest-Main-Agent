# InfTest 文档索引

> 明天上服务器联调，优先看第 1 份。

## 1. 服务器部署与真实 Agent 联调

- [InfTest 服务器部署联调手册](./InfTest_服务器部署联调手册.md)

用途：到服务器后按步骤部署代码、配置真实 CLI Agent、跑通：

```text
InfTest 主 Agent
  -> 静态测试计划
  -> CLI 调用用例执行 Agent
  -> CLI 调用报告生成 Agent
  -> 输出 SUCCESS 和报告路径
```

## 2. 当前可用 Agent 链路

- [InfTest 当前可用 Agent 联调测试计划](./InfTest_当前可用Agent联调测试计划.md)

用途：说明当前为什么跳过用例生成 Agent、如何用静态测试计划先接执行 Agent 和报告 Agent。

## 3. 日常操作手册

- [CCB InfTest Demo 操作手册](./CCB_InfTest_操作手册.md)

用途：本地 fake E2E、query E2E、HTTP demo、常用命令。

## 4. 开发状态

- [CCB InfTest 开发进度](./CCB_InfTest_开发进度.md)
- [InfTest Demo 测试用例](./InfTest_Demo_测试用例.md)

用途：看当前完成了什么、没完成什么、测试用例怎么跑。

## 5. 设计与接口文档

- [API Contract](./API_CONTRACT.md)
- [Architecture](./ARCHITECTURE.md)
- [Planner Design](./PLANNER_DESIGN.md)
- [CCB InfTest 主 Agent 改造计划](./CCB_InfTest主Agent改造计划.md)

用途：看目标架构、接口定义、主 Agent 规划设计。

## 6. 真实子 Agent 原始文档

- [用例执行 Agent 使用文档](./subagent/用例执行Agent使用文档.md)
- [测试报告生成 Agent 使用文档](./subagent/测试报告生成%20Agent%20使用文档.md)

用途：确认真实 Agent 原始 CLI 命令和输入/输出格式。

## 当前最重要的结论

- 真实业务 Agent 是 **CLI 调用**，不是 HTTP 调用。
- HTTP API 只是平台未来启动 InfTest 主 Agent 的外部入口。
- 明天服务器联调优先跑 CLI：

```bash
INFTEST_CONFIG=.inftest/config.available-agents.example.json \
bun run scripts/inftest_available_agents_e2e.ts --task-id task-server-001 --timeout-seconds 900
```

- 当前用例生成 Agent 不可用，所以先由主 Agent 生成静态测试计划。
- 当前已准备真实执行 Agent / 报告 Agent 的适配脚本：

```text
scripts/inftest_real_execution_agent_adapter.py
scripts/inftest_real_report_agent_adapter.py
```
