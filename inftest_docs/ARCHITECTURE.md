# ARCHITECTURE.md — Planner Agent 技术架构说明

> 本文档用于指导 AI 编码助手理解 Planner Agent 所处的系统环境、技术栈选型、通信方式及依赖关系。
> ⚠️ 标注【待确认】的部分需要你根据团队实际情况填写。

---

## 1. 系统全景

```
┌──────────────────────────────────────────────────────────────────┐
│                        前端管理后台 (Web)                         │
└──────────────────────┬───────────────────────────────────────────┘
                       │ HTTP (Protobuf/JSON)
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                      后端云服务 (Go + GORM)                       │
│  - 项目管理  - 测试计划管理  - 任务管理  - 用例库  - 缺陷管理       │
│  - 模型配置  - OSS文件管理   - 登录认证                            │
└────────┬─────────────────────────────────┬───────────────────────┘
         │ HTTP                            │ HTTP/WebSocket
         ▼                                 ▼
┌────────────────────┐          ┌──────────────────────────────────┐
│   轻量化代理服务     │          │       设备云服务 + 设备终端         │
│  (Proxy Service)   │          │  - 设备注册/注销/重启/释放/心跳     │
│  - 路由转发          │          │  - WebSocket 操作交互              │
│  - 健康检查          │          │  - 设备池管理                      │
│  - 任务分发          │          └──────────────────────────────────┘
└────────┬─────────────┘                    ▲
         │ HTTP                             │ HTTP (cmd-bridge)
         ▼                                  │
┌──────────────────────────────────────────────────────────────────┐
│                     ★ Planner Agent (本项目)                      │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐             │
│  │ 用例生成Agent │  │ 设备调度Agent │  │ 用例执行Agent  │             │
│  │  (CLI调用)   │  │  (CLI调用)   │  │  (CLI调用)    │             │
│  └─────────────┘  └─────────────┘  └──────────────┘             │
│  ┌─────────────┐  ┌──────────────────┐                           │
│  │ 结果分析Agent │  │ 测试计划报告Agent  │                           │
│  │  (CLI调用)   │  │   (CLI调用)      │                           │
│  └─────────────┘  └──────────────────┘                           │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| 语言 | Python 3.10+ | 【待确认】Agent 侧统一用 Python |
| Agent 框架 | 【待确认】自研 / LangGraph / AutoGen | 选定后在此注明 |
| HTTP 框架 | FastAPI | Planner 需暴露 HTTP 接口供代理服务调用 |
| LLM 调用 | 【待确认】OpenAI 兼容 / 自研 LLM Client | 使用后端模型配置下发的模型ID |
| 序列化 | Protobuf + JSON | 与代理服务通信用 Protobuf，子 Agent 日志用 JSON |
| 日志 | 结构化 JSON 日志 | 写入 `./log/${task_id}/${agent_name}.log` |
| 文件存储 | OSS (对象存储) | 【待确认】SDK / 访问方式 |
| 进程管理 | subprocess | 子 Agent 通过 CLI 命令行调用 |

---

## 3. Planner Agent 部署形态

Planner Agent 运行在**轻量化代理服务的容器内**，以独立进程方式存在。

```
┌─── 代理服务容器 ───────────────────────────┐
│                                           │
│  代理服务进程 (路由/转发)                    │
│       │                                   │
│       │  HTTP (localhost)                  │
│       ▼                                   │
│  Planner Agent 进程 (FastAPI)              │
│       │                                   │
│       │  subprocess (CLI)                  │
│       ▼                                   │
│  子Agent进程 (按需启动，执行完退出)           │
│                                           │
│  共享文件系统:                               │
│    ./log/{task_id}/        ← 日志目录       │
│    ./test_case/            ← 用例产物       │
│    ./report/               ← 报告产物       │
└───────────────────────────────────────────┘
```

---

## 4. 通信方式详解

### 4.1 代理服务 → Planner Agent (HTTP)

代理服务通过 HTTP POST 调用 Planner 暴露的接口。Planner 需要实现以下 HTTP 端点：

| 端点 | 触发方 | 用途 |
|------|--------|------|
| `POST /api/generate-plan` | 代理服务 | 下发计划生成请求 |
| `POST /api/batch-execute-tasks` | 代理服务 | 下发用户审核后的任务列表并启动执行 |
| `POST /api/case-publish` | 代理服务 | 下发用户审核后的测试用例 |
| `POST /api/task-manage` | 代理服务 | 暂停/继续/终止任务 |
| `POST /api/payload` | 代理服务 | 用户指令注入 (流式响应) |

### 4.2 Planner Agent → 代理服务 (HTTP)

Planner 主动调用代理服务接口上报状态和结果：

| 端点 | 用途 |
|------|------|
| `POST {proxy}/api/plan-task-submit` | 上报生成的任务列表 |
| `POST {proxy}/api/task-status-update` | 上报任务阶段状态和进度 |
| `POST {proxy}/api/plan-result-report` | 上报最终计划结果(报告+缺陷) |

### 4.3 Planner Agent → 子 Agent (CLI / subprocess)

所有子 Agent 都通过**命令行调用**，不是 HTTP。Planner 启动子进程，然后通过**轮询 JSON 日志文件**获取执行状态。

```python
# 示例：调用用例生成 Agent
subprocess.Popen(
    f"cat {req_json_path} | cli_test_plan_agent",
    shell=True, cwd=working_dir
)
# 然后轮询 ./test_case/test_case_generate.json 读取日志
```

| 子 Agent | 调用命令 | 日志/产物路径 |
|----------|----------|---------------|
| 用例生成 Agent | `cat {req.json} \| cli_test_plan_agent` | `./test_case/test_case_generate.json` |
| 设备调度 Agent | `python -m device_agent bind --task-id X --case-count N` | 返回 JSON (stdout) |
| 用例执行 Agent | `python run_API.py execute --user-id X --project-id X ...` | `./log/{task_id}/` 下的日志 |
| 结果分析 Agent | 【待确认】CLI 命令 | `./report/` 下的报告文件 |

### 4.4 执行 Agent → 设备层 (HTTP via 代理服务)

执行 Agent 操控设备时，不直接连 WebSocket，而是通过代理服务的 HTTP 桥接接口：

```
执行Agent → POST {proxy}/api/cmd-bridge/submit → 代理服务 → WebSocket → 设备终端
```

---

## 5. 数据流与文件约定

### 5.1 目录结构

```
{working_dir}/
├── log/
│   └── {task_id}/
│       ├── planner.log                  # Planner 自身日志
│       ├── case_generation_agent.log    # 用例生成日志
│       ├── device_scheduling_agent.log  # 设备调度日志
│       ├── case_execution_agent.log     # 执行日志
│       └── result_analysis_agent.log    # 结果分析日志
├── test_case/
│   └── test_case_generate.json          # 用例生成过程日志（逐行JSON）
├── report/
│   └── {task_id}_report.md              # 测试报告
└── tmp/
    ├── req_{task_id}.json               # 子Agent请求文件
    └── device_case_bind_{task_id}.json  # 设备-用例绑定文件
```

### 5.2 日志格式（所有 Agent 统一）

每行一个 JSON 对象：

```json
{
  "agent_name": "case_generation_agent",
  "event_type": "agent_started",
  "desc": { "start_time": "2026-05-22T10:00:00Z" }
}
```

### 5.3 子 Agent 关键 event_type 速查

| Agent | event_type | 含义 |
|-------|-----------|------|
| 用例生成 | `agent_started` | 开始生成 |
| 用例生成 | `case_generation_summary` | desc.count = 用例数量 |
| 用例生成 | `artifact_created` | desc.path = 用例文件路径 |
| 用例生成 | `agent_finished` | 生成完成 |
| 用例生成 | `agent_failed` | desc.reason = 失败原因 |
| 设备调度 | `device_bindedto_task` | 设备绑定完成 |
| 执行 | `case_started` | 单条用例开始执行 |
| 执行 | `step_action_executed` | 单步操作完成 |
| 执行 | `case_finished` | 单条用例执行完成 |
| 执行 | `case_failed` | 单条用例执行失败 |
| 结果分析 | `plan_report_started` | 报告生成开始 |
| 结果分析 | `plan_report_finished` | 报告生成完成 |
| 结果分析 | `plan_report_failed` | 报告生成失败 |

---

## 6. 关键配置项

Planner 从 `CreateTestPlanRequest.plan_config_info` 中获取运行时配置：

```python
class PlanConfigInfo:
    # 去重配置
    decup_config.top_k: int              # 去重检索 top-k
    decup_config.similarity_threshold: float  # 相似度阈值
    decup_config.max_overlap_checks: int # 最大去重检查数

    # 用例生成配置
    case_generate_info.max_depth: int           # 用例树最大深度
    case_generate_info.included_case_nums: int  # 单任务最大生成用例数 (默认500)

    # 用例执行配置
    case_execution_info.max_case_retry_num: int     # 最大重试次数 (默认3)
    case_execution_info.max_timeout_minutes: int    # 单步超时(秒) (默认120)

    # 并发与模型
    included_worker_nums: int     # 单任务最大并行数 (默认8)
    enable_multimodal: bool       # 是否启用多模态
    llm_model_config_id: int      # 语言模型ID
    embedding_model_config_id: int # 向量模型ID
    multimodal_model_config_id: int # 多模态模型ID (可为空)
```

---

## 7. 外部依赖清单

| 依赖 | 用途 | 访问方式 |
|------|------|----------|
| 代理服务 (Proxy) | 状态上报、设备操作桥接 | HTTP, 同容器 localhost |
| LLM 服务 | 计划生成、推理 | 【待确认】HTTP API |
| OSS | 读取PRD文件、上传报告 | 【待确认】SDK |
| cli_test_plan_agent | 用例生成子Agent | CLI, 已预装在容器内 |
| device_agent | 设备调度子Agent | CLI (`python -m device_agent`) |
| run_API.py | 用例执行子Agent | CLI (`python run_API.py`) |
| 结果分析 Agent | 报告生成 | 【待确认】CLI 命令 |
