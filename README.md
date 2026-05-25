# Claude Code Best V5 (CCB)

[![GitHub Stars](https://img.shields.io/github/stars/claude-code-best/claude-code?style=flat-square&logo=github&color=yellow)](https://github.com/claude-code-best/claude-code/stargazers)
[![GitHub Contributors](https://img.shields.io/github/contributors/claude-code-best/claude-code?style=flat-square&color=green)](https://github.com/claude-code-best/claude-code/graphs/contributors)
[![GitHub Issues](https://img.shields.io/github/issues/claude-code-best/claude-code?style=flat-square&color=orange)](https://github.com/claude-code-best/claude-code/issues)
[![GitHub License](https://img.shields.io/github/license/claude-code-best/claude-code?style=flat-square)](https://github.com/claude-code-best/claude-code/blob/main/LICENSE)
[![Last Commit](https://img.shields.io/github/last-commit/claude-code-best/claude-code?style=flat-square&color=blue)](https://github.com/claude-code-best/claude-code/commits/main)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun)](https://bun.sh/)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord)](https://discord.gg/qZU6zS7Q)

> Which Claude do you like? The open source one is the best.

牢 A (Anthropic) 官方 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 工具的源码反编译/逆向还原项目。目标是将 Claude Code 大部分功能及工程化能力复现 (问就是老佛爷已经付过钱了)。虽然很难绷, 但是它叫做 CCB(踩踩背)... 而且, 我们实现了企业版或者需要登陆 Claude 账号才能使用的特性, 实现技术普惠

[文档在这里, 支持投稿 PR](https://ccb.agent-aura.top/) | [留影文档在这里](./Friends.md) | [Discord 群组](https://discord.gg/qZU6zS7Q)

| 特性 | 说明 | 文档 |
|------|------|------|
| **Claude 群控技术** | Pipe IPC 多实例协作：同机 main/sub 自动编排 + LAN 跨机器零配置发现与通讯，`/pipes` 选择面板 + `Shift+↓` 交互 + 消息广播路由 | [Pipe IPC](https://ccb.agent-aura.top/docs/features/pipes-and-lan) / [LAN](https://ccb.agent-aura.top/docs/features/lan-pipes) |
| **ACP 协议一等一支持** | 支持接入 Zed、Cursor 等 IDE，支持会话恢复、Skills、权限桥接 | [文档](https://ccb.agent-aura.top/docs/features/acp-zed) |
| **Remote Control 私有部署** | Docker 自托管远程界面, 可以手机上看 CC | [文档](https://ccb.agent-aura.top/docs/features/remote-control-self-hosting) |
| **Langfuse 监控** | 企业级 Agent 监控, 可以清晰看到每次 agent loop 细节, 可以一键转化为数据集 | [文档](https://ccb.agent-aura.top/docs/features/langfuse-monitoring) |
| **Web Search** | 内置网页搜索工具, 支持 bing 和 brave 搜索 | [文档](https://ccb.agent-aura.top/docs/features/web-browser-tool) |
| **Poor Mode** | 穷鬼模式，关闭记忆提取和键入建议,大幅度减少并发请求 | /poor 可以开关 |
| **Channels 频道通知** | MCP 服务器推送外部消息到会话（飞书/Slack/Discord 等），`--channels plugin:name@marketplace` 启用 | [文档](https://ccb.agent-aura.top/docs/features/channels) |
| **自定义模型供应商** | OpenAI/Anthropic/Gemini/Grok 兼容 | [文档](https://ccb.agent-aura.top/docs/features/custom-platform-login) |
| Voice Mode | Push-to-Talk 语音输入 | [文档](https://ccb.agent-aura.top/docs/features/voice-mode) |
| Computer Use | 屏幕截图、键鼠控制 | [文档](https://ccb.agent-aura.top/docs/features/computer-use) |
| Chrome Use | 浏览器自动化、表单填写、数据抓取 | [自托管](https://ccb.agent-aura.top/docs/features/chrome-use-mcp) [原生版](https://ccb.agent-aura.top/docs/features/claude-in-chrome-mcp) |
| Sentry | 企业级错误追踪 | [文档](https://ccb.agent-aura.top/docs/internals/sentry-setup) |
| GrowthBook | 企业级特性开关 | [文档](https://ccb.agent-aura.top/docs/internals/growthbook-adapter) |
| /dream 记忆整理 | 自动整理和优化记忆文件 | [文档](https://ccb.agent-aura.top/docs/features/auto-dream) |

- 🚀 [想要启动项目](#快速开始源码版)
- 🐛 [想要调试项目](#vs-code-调试)
- 📖 [想要学习项目](#teach-me-学习项目)


## ⚡ 快速开始(安装版)

不用克隆仓库, 从 NPM 下载后, 直接使用

```sh
bun  i -g claude-code-best
bun pm -g trust claude-code-best
ccb # 以 nodejs 打开 claude code
ccb-bun # 以 bun 形态打开
CLAUDE_BRIDGE_BASE_URL=https://remote-control.claude-code-best.win/ CLAUDE_BRIDGE_OAUTH_TOKEN=test-my-key ccb --remote-control # 我们有自部署的远程控制
```

## ⚡ 快速开始(源码版)

### ⚙️ 环境要求

一定要最新版本的 bun 啊, 不然一堆奇奇怪怪的 BUG!!! bun upgrade!!!

- 📦 [Bun](https://bun.sh/) >= 1.3.11
- ⚙️ 常规的配置 CC 的方式, 各大提供商都有自己的配置方式

### 📥 安装

```bash
bun install
```

### ▶️ 运行

```bash
# 开发模式, 看到版本号 888 说明就是对了
bun run dev

# 构建
bun run build
```

构建采用 code splitting 多文件打包（`build.ts`），产物输出到 `dist/` 目录（入口 `dist/cli.js` + 约 450 个 chunk 文件）。

构建出的版本 bun 和 node 都可以启动, 你 publish 到私有源可以直接启动

如果遇到 bug 请直接提一个 issues, 我们优先解决

### 👤 新人配置 /login

首次运行后，在 REPL 中输入 `/login` 命令进入登录配置界面，选择 **Anthropic Compatible** 即可对接第三方 API 兼容服务（无需 Anthropic 官方账号）。
选择 OpenAI 和 Gemini 对应的栏目都是支持相应协议的

需要填写的字段：

| 📌 字段 | 📝 说明 | 💡 示例 |
|------|------|------|
| Base URL | API 服务地址 | `https://api.example.com/v1` |
| API Key | 认证密钥 | `sk-xxx` |
| Haiku Model | 快速模型 ID | `claude-haiku-4-5-20251001` |
| Sonnet Model | 均衡模型 ID | `claude-sonnet-4-6` |
| Opus Model | 高性能模型 ID | `claude-opus-4-6` |

- ⌨️ **Tab / Shift+Tab** 切换字段，**Enter** 确认并跳到下一个，最后一个字段按 Enter 保存


> ℹ️ 支持所有 Anthropic API 兼容服务（如 OpenRouter、AWS Bedrock 代理等），只要接口兼容 Messages API 即可。

## Feature Flags

所有功能开关通过 `FEATURE_<FLAG_NAME>=1` 环境变量启用，例如：

```bash
FEATURE_BUDDY=1 FEATURE_FORK_SUBAGENT=1 bun run dev
```

各 Feature 的详细说明见 [`docs/features/`](docs/features/) 目录，欢迎投稿补充。


## InfTest MVP 使用方式

## InfTest 架构（v2）

- **主 Agent**：CCB `QueryEngine` + InfTest tools（平台通过 HTTP 调 `/tasks/*`，不经过 REPL）。
- **子 Agent**：CLI 子进程（`invoke_subagent` → `SubAgentAdapter` → `python3 mock_agents/...` 或你在 `.inftest/config.json` 配置的命令）。**不是** CCB 内置 `forkedAgent`/swarm 业务子 Agent。
- **编排模式**（`INFTEST_ORCHESTRATION` 或 config `orchestration`）：
  - `aggregate`（默认）：仅 `run_fake_e2e`，`make query-e2e` 固定走此路径。
  - `stepwise`（实验）：完整 tools，逐步 `invoke_subagent`；`make query-e2e-stepwise`。
- **Proxy**：可选 `INFTEST_PROXY_BASE_URL` + `INFTEST_PROXY_TASK_REPORT_PATH`，`report_task_update` 将 JSON POST 到 Planner（未配置则本地 stub）。

### 真实 CLI 子 Agent 接入顺序（P3）

替换时**只改** `.inftest/config.json` 的 `subagents` 映射，保持 `invoke_subagent` 参数不变：

1. 测试生成（`test_generation`）
2. 结果分析（`result_analyzer`）
3. 设备调度（`device_scheduler`）
4. 测试执行（`test_executor`）

每个子进程必须支持：`--task-id`、`--workspace`、`--output-json`，并写入符合仓库内 Zod schema 的 JSON（参见 `src/inftest/schemas/subagentOutput.ts`）。





InfTest 是在 CCB 仓库内嵌入的 **测试任务编排 MVP**：将 CCB 作为 Planner/Reflection 主 Agent 运行时，通过 HTTP API 或命令行脚本跑通「查任务 → 建 workspace → 生成计划 → 调 fake 子 Agent → 监听结果 → 上报 SUCCESS」的闭环。

> 设计文档与开发进度见 [`inftest_docs/`](inftest_docs/)，详细命令示例见 [`inftest_docs/CCB_InfTest_操作手册.md`](inftest_docs/CCB_InfTest_操作手册.md)。

### 前置条件

- 在仓库根目录执行（需已 `bun install`）
- 推荐使用根目录 `Makefile`（自动使用本机 Bun 并设置 PATH）：

```bash
make typecheck   # 可选，确认类型检查通过
```

### 文件配置（推荐）

模型与子 Agent 分开：**子 Agent 仍不需要 API**；只有 query / chat 需要模型凭证。

1. 复制模板并填入密钥（文件已 gitignore，不会提交）：

```bash
cp .inftest/config.example.json .inftest/config.json
# 编辑 .inftest/config.json，填写 model.api_key
```

2. 可选：`.inftest/config.local.json` 覆盖局部字段（例如只改 `model.name`），会叠在 `config.json` 之上。

3. 优先级：**已存在的环境变量 > 配置文件 > 默认值**。CI 仍可用 `ANTHROPIC_API_KEY` 覆盖文件。

| 配置项 | 写入 env | 用途 |
|--------|----------|------|
| `model.api_key` | `ANTHROPIC_API_KEY` | Anthropic / 兼容层 API Key |
| `model.auth_token` | `ANTHROPIC_AUTH_TOKEN` | 网关 Bearer（与 api_key 二选一） |
| `model.base_url` | `ANTHROPIC_BASE_URL` | 代理或兼容 API 地址 |
| `model.name` | `INFTEST_MODEL` | 模型 ID |
| `runner` | `INFTEST_RUNNER` | `fake` / `query` |
| `server.host` / `server.port` | `INFTEST_HOST` / `INFTEST_PORT` | HTTP 服务 |
| `workspace_root` | `INFTEST_WORKSPACE_ROOT` | 任务工作区根目录 |

自定义路径：`INFTEST_CONFIG=/path/to/inftest.json`。用户级：`~/.inftest/config.json`。

配置好后直接：

```bash
make query-e2e
make server    # runner 读自 config.json 的 runner 字段
```

仍可使用 `~/.claude/settings.json` 的 `env` 块；InfTest 会在 bootstrap 时先加载 `.inftest/config.json`，再加载 CCB 全局 settings。


### Fake 模式（推荐验收）

**不依赖大模型**，确定性跑通全流程，适合 CI 与领导演示第一站。

| 步骤 | 命令 |
|------|------|
| 1. 命令行 E2E | `make fake-e2e` |
| 2. 启动 HTTP 服务 | `make server`（默认 `http://127.0.0.1:8787`） |
| 3. 通过 API 启动任务 | 见下方 `curl` |

```bash
# 终端 A：启动服务
make server

# 终端 B：启动任务（默认 fake runner，对齐 InfTest 接口文档）
curl -sS -X POST http://127.0.0.1:8787/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-demo-001","task_operation":"START"}'
```

**预期**：`code` 为 `0`，`data.task_status` 为 `SUCCESS`，`data.runner` 为 `fake`，`data.artifacts` 包含各产物路径。

可选 API 级自动验收（无需手敲 curl）：

```bash
make api-e2e-fake
```

### Query 模式（需模型凭证）

通过 headless `QueryEngine.submitMessage` 驱动，由模型调用 `run_fake_e2e` tool（内部仍执行与 fake 模式相同的 deterministic 流程）。

| 步骤 | 命令 |
|------|------|
| 1. 命令行 E2E | `make query-e2e`（需 `ANTHROPIC_API_KEY` 或 `/login` 配置） |
| 2. 启动 HTTP 服务 | `INFTEST_RUNNER=query make server` |
| 3. 通过 API 启动任务 | 同上 `POST /tasks/alter` + `task_operation: START` |

```bash
# 需先配置模型（REPL 中 /login 或环境变量 ANTHROPIC_API_KEY）
INFTEST_RUNNER=query make server

curl -sS -X POST http://127.0.0.1:8787/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-demo-001","task_operation":"START"}'
```

**预期**：`data.runner` 为 `query`，`data.task_status` 为 `SUCCESS`；`GET /tasks/task-demo-001` 的 `data.task_detail.run_fake_e2e_invoked` 为 `true`。

```bash
make api-e2e-query   # 需模型凭证；无凭证时 exit 2
```

### 产物位置

默认 workspace 根目录：仓库内 **`.inftest-workspace/{task_id}/`**（可通过环境变量 `INFTEST_WORKSPACE_ROOT` 覆盖）。

以 `task-demo-001` 为例，关键文件：

| 产物 | 路径 |
|------|------|
| PlanDAG | `.inftest-workspace/task-demo-001/plan.json` |
| 测试用例 | `.inftest-workspace/task-demo-001/case_generation/test_cases.json` |
| 设备绑定 | `.inftest-workspace/task-demo-001/device_scheduling/device_bindings.json` |
| 执行摘要 | `.inftest-workspace/task-demo-001/execution/results/summary.json` |
| 分析报告 | `.inftest-workspace/task-demo-001/analysis/report.md` |

`POST /tasks/alter`（START）成功时，响应 `data` 里的 `artifacts` 字段会给出上述文件的绝对路径。

### HTTP 接口（对齐 InfTest 接口文档）

统一响应包：`{ "code": number, "message": string, "data"?: object }`。`code === 0` 表示成功。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 探活 |
| POST | `/tasks/alter` | START / PAUSE / CONTINUE |
| POST | `/tasks/terminate` | 终止任务 |
| GET | `/tasks/{task_id}` | 查询任务详情 |
| POST | `/tasks/chat/stream` | 流式问答（SSE，`ChatStreamResponse` 包在每条 `data:` 里） |

```bash
# 健康检查
curl -sS http://127.0.0.1:8787/health

# 查询任务详情
curl -sS http://127.0.0.1:8787/tasks/task-demo-001

# 暂停 / 继续（需先 START 成功）
curl -sS -X POST http://127.0.0.1:8787/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-demo-001","task_operation":"PAUSE"}'

curl -sS -X POST http://127.0.0.1:8787/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-demo-001","task_operation":"CONTINUE"}'

# 终止
curl -sS -X POST http://127.0.0.1:8787/tasks/terminate \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-demo-001"}'

# 流式问答（需模型凭证；body 含 user_id）
curl -N -X POST http://127.0.0.1:8787/tasks/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"user_id":"user-demo","task_id":"task-demo-001","user_instruction":"总结一下当前任务状态"}'
```

### 当前未实现（MVP 范围外）

| 能力 | 说明 |
|------|------|
| 真实子 Agent | 仍为 `mock_agents/*.py` fake 脚本，未接真实测试生成/设备调度/执行/分析 Agent |
| `/tasks/chat/stream` 完整生产能力 | 已有 SSE MVP（基于 session 上下文 + QueryEngine），无会话级流中断恢复、无与长任务执行的深度联动 |
| 真实设备控制 | 无真实设备操作与平台设备池 |
| 深度 PAUSE/CONTINUE | 仅更新 `TaskSessionManager` 状态；不暂停模型流、不恢复真实执行 Agent |

### 演示流程（领导验收推荐）

约 **5–10 分钟**，按稳定性从高到低：

1. **证明链路可重复**（无模型）

   ```bash
   make fake-e2e
   ```

   展示终端 JSON 中 `task_status: SUCCESS`，并打开 `.inftest-workspace/task-demo-001/plan.json` 与 `analysis/report.md`。

2. **证明平台 HTTP 接入**

   ```bash
   make server
   ```

   另开终端执行 `POST /tasks/alter` START（见上文 curl），对照响应中的 `artifacts` 与磁盘文件。

3. **证明任务可查询与控制**

   ```bash
   curl -sS http://127.0.0.1:8787/tasks/task-demo-001
   ```

   依次演示 `/tasks/alter` PAUSE/CONTINUE 与 `/tasks/terminate`，说明状态字段变化（MVP 级控制）。

4. **（可选）证明 CCB headless Agent 能力**

   配置 API 后：

   ```bash
   INFTEST_RUNNER=query make server
   ```

   再次 `POST /tasks/alter` START，强调 `runner: query` 与 `run_fake_e2e_invoked: true`。

5. **（可选）流式问答**

   在任务已成功 START 后，调用 `POST /tasks/chat/stream`，展示 SSE 增量输出。

**一句话总结**：CCB 已作为 InfTest 主 Agent 运行时接入；fake 模式可零模型依赖完成端到端演示，query 模式验证大模型通过 tool 驱动同一套 fake 闭环。


## VS Code 调试

TUI (REPL) 模式需要真实终端，无法直接通过 VS Code launch 启动调试。使用 **attach 模式**：

### 步骤

1. **终端启动 inspect 服务**：
   ```bash
   bun run dev:inspect
   ```
   会输出类似 `ws://localhost:8888/xxxxxxxx` 的地址。

2. **VS Code 附着调试器**：
   - 在 `src/` 文件中打断点
   - F5 → 选择 **"Attach to Bun (TUI debug)"**


## Teach Me 学习项目

我们新加了一个 teach-me skills, 通过问答式引导帮你理解这个项目的任何模块。(调整 [sigma skill 而来](https://github.com/sanyuan0704/sanyuan-skills))

```bash
# 在 REPL 中直接输入
/teach-me Claude Code 架构
/teach-me React Ink 终端渲染 --level beginner
/teach-me Tool 系统 --resume
```

### 它能做什么

- **诊断水平** — 自动评估你对相关概念的掌握程度，跳过已知的、聚焦薄弱的
- **构建学习路径** — 将主题拆解为 5-15 个原子概念，按依赖排序逐步推进
- **苏格拉底式提问** — 用选项引导思考，而非直接给答案
- **错误概念追踪** — 发现并纠正深层误解
- **断点续学** — `--resume` 从上次进度继续

### 学习记录

学习进度保存在 `.claude/skills/teach-me/` 目录下，支持跨主题学习者档案。

## 相关文档及网站

- **在线文档（Mintlify）**: [ccb.agent-aura.top](https://ccb.agent-aura.top/) — 文档源码位于 [`docs/`](docs/) 目录，欢迎投稿 PR
- **DeepWiki**: <https://deepwiki.com/claude-code-best/claude-code>

## Contributors

<a href="https://github.com/claude-code-best/claude-code/graphs/contributors">
  <img src="contributors.svg" alt="Contributors" />
</a>

## Star History

<a href="https://www.star-history.com/?repos=claude-code-best%2Fclaude-code&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=claude-code-best/claude-code&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=claude-code-best/claude-code&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=claude-code-best/claude-code&type=date&legend=top-left" />
 </picture>
</a>

## 许可证

本项目仅供学习研究用途。Claude Code 的所有权利归 [Anthropic](https://www.anthropic.com/) 所有。
