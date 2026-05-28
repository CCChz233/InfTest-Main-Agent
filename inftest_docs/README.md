# InfTest 文档索引

> 明天上服务器联调，优先看第 1 份。

## 1. 服务器部署与真实 Agent 联调

- [InfTest 服务器部署流程与注意事项](./InfTest_服务器部署流程与注意事项.md)
- [InfTest 服务器部署联调手册](./InfTest_服务器部署联调手册.md)

用途：到服务器后按步骤部署代码、配置真实 CLI Agent、跑通：

```text
InfTest 主 Agent
  -> 静态测试计划
  -> CLI 调用用例执行 Agent
  -> CLI 调用报告生成 Agent
  -> 输出 SUCCESS 和报告路径
```

流程与注意事项文档是当前 `stateful` runner 上服务器的首选短手册；部署联调手册保留更早的 CLI 联调背景和详细排障记录。

## 2. 当前可用 Agent 链路

- [InfTest 当前可用 Agent 联调测试计划](./InfTest_当前可用Agent联调测试计划.md)
- [InfTest API 全真模拟联调经验手册](./InfTest_API全真模拟联调经验手册.md)
- [InfTest API 全真模拟测试用例](./InfTest_API全真模拟测试用例.md)
- [InfTest Mock 后端端口 Query 模式联调手册](./InfTest_Mock后端端口Query模式联调手册.md)
- [InfTest Postman 智能体代理服务模拟测试用例](./InfTest_Postman_智能体代理服务模拟测试用例.md)

用途：说明当前为什么跳过用例生成 Agent、如何用静态测试计划先接执行 Agent 和报告 Agent。

经验手册额外记录本机 API 全真模拟的已验证命令、mock 执行产物开关、本地模型 stub、成功产物和排障经验。

测试用例文档记录当前静态用例的步骤、预期结果、`device_case_bind.json`、mock `case_result.json` 和复用命令。

Mock 后端端口手册记录 `query + stepwise` 模式如何模拟平台用户从后端端口发起任务，并验证主 Agent 模型编排与工具调用闭环。

Postman 测试用例文档记录如何用 Postman 模拟智能体代理服务与主 Agent 的 HTTP 交互，并附带可导入的 Postman collection。

## 3. 日常操作手册

- [CCB InfTest Demo 操作手册](./CCB_InfTest_操作手册.md)

用途：本地 fake E2E、query E2E、HTTP demo、常用命令。

## 4. 开发状态

- [CCB InfTest 开发进度](./CCB_InfTest_开发进度.md)
- [InfTest Demo 测试用例](./InfTest_Demo_测试用例.md)

用途：看当前完成了什么、没完成什么、测试用例怎么跑。

## 5. 设计与接口文档

- [API Contract](./API_CONTRACT.md)
- [InfTest 主 Agent 接口交互专用文档](./InfTest_主Agent接口交互专用文档.md)
- [InfTest 主 Agent 状态机 / Skill / Hook 设计](./InfTest_主Agent状态机SkillHook设计.md)
- [Architecture](./ARCHITECTURE.md)
- [Planner Design](./PLANNER_DESIGN.md)
- [CCB InfTest 主 Agent 改造计划](./CCB_InfTest主Agent改造计划.md)

用途：看目标架构、接口定义、主 Agent 规划设计。

主 Agent 专用接口文档从完整接口文档中抽出 Planner Agent 直接相关的调用方、被调用接口、主动回调接口、CLI 子 Agent 接口和 Postman 实验路径。

状态机 / Skill / Hook 设计文档记录下一步从脚本式 available runner 收敛到显式状态机驱动主 Agent 的目标结构、状态集合、SkillRegistry、HookManager、用户指令注入和开发顺序。

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
- 如果要模拟“用户从平台端口发起任务”，使用 `INFTEST_RUNNER=query` + `INFTEST_ORCHESTRATION=stepwise` + mock 后端端口；`available` 只适合验证真实 CLI adapter 接线。
- 当前已准备真实执行 Agent / 报告 Agent 的适配脚本：

```text
scripts/inftest_real_execution_agent_adapter.py
scripts/inftest_real_report_agent_adapter.py
```
