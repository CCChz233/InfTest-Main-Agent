# InfTest Execute Agent 调用技能

本技能说明**如何从项目根目录**触发用例执行，以及**如何读取执行产物**。所有路径均相对于**仓库根目录**（下文简称「项目根」）。

---

## 1. 调用方式（CLI）

### 1.1 命令

```bash
python run_API.py execute \
  --user-id u001 \
  --project-id xh \
  --task-id roger \
  --device-case-bind @./device_case_bind.sample1.json \
  --used-model glm-4.7 \
  --enable-multimodal-assertion false \
  --enable-multimodal-attribution false \
  --user-payload "The instructions injected here for the users can be optional"
```

## 2. device_case_bind 格式

文件示例：`device_case_bind.sample1.json`

```json
{
  "case": {
      "case_id": "1.1",
      "title": "验证掌上新华APP首页常规搜索流程，首页搜索功能",
      "condition": "设备处于正常可用状态，掌上新华APP已正确安装",
      "steps": [
          {
              "step_id": "1.1.1",
              "action": "退到桌面",
              "expected": "成功退到桌面"
          },
          {
              "step_id": "1.1.2",
              "action": "打开掌上新华APP",
              "expected": "APP成功启动并进入首页"
          },
          {
              "step_id": "1.1.3",
              "action": "点击首页搜索框",
              "expected": "搜索框可正常聚焦并输入"
          },
          {
              "step_id": "1.1.4",
              "action": "输入关键字“健康”并执行搜索",
              "expected": "返回包含关键字相关的搜索结果"
          }
      ]
  },
  "device_id": "SM02G4061977180"
}
```

---

## 3. 日志与产物在哪里查

### 3.1 目录布局（相对项目根）

```
logs/<task_id>/
├── task_log_<run_id>.log          # 任务级运行日志（run_id 通常与 task_id 相同）
├── <case_id>/
│   ├── case_result.json           # ★ 单条用例结构化结果（主产物）
│   └── screenshots/
│       ├── 0001_*.png
│       └── 0002_*.png
└── <case_id_2>/
    └── ...
```

示例（`task_id=roger`，`case_id=roger_case_001`）：

- 用例结果：`logs/roger/roger_case_001/case_result.json`
- 截图目录：`logs/roger/roger_case_001/screenshots/`
- 任务日志：`logs/roger/task_log_roger.log`（文件名随 run_id 变化）

**注意**：同 `task_id` 重跑会**覆盖**同 case 目录下截图与结果。

---

## 4. case_result.json 格式

路径：`logs/<task_id>/<case_id>/case_result.json`

`steps_info[].snapshot` 与截图文件路径均为**相对 `logs/<task_id>/` 的相对路径**（不是相对项目根）。

### 4.1 顶层字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `task_id` | string | 任务 ID |
| `case_index` | number | 用例序号（从 1 起） |
| `case_id` | string | 用例 ID（与目录名一致） |
| `case_name` | string | 场景名，多来自 `test_scenario` |
| `case_step` | string | 合并后的步骤描述（前缀 `开始任务: `） |
| `expected_result` | string[] | 预期结果列表 |
| `status` | string | `pass` 或 `fail` |
| `steps_info` | array | 逐步日志与截图引用 |
| `reason` | string 或 object | 失败原因；开启失败归因时为结构化 JSON 对象 |
| `time` | string | 起止时间，如 `17:13:41 - 17:17:52` |
| `device` | object | `device_id`、`device_name`、`device_type` 等 |
| `execution_model` | string | 实际执行模型 |
| `failure_attribution_model` | string | 归因模型 |
| `enable_multimodal_assertion` | boolean | 与请求一致 |
| `enable_multimodal_attribution` | boolean | 与请求一致 |
| `token_consumption` | object | LLM token 统计（见下） |

### 4.2 steps_info[]

```json
{
  "step_idx": 2,
  "logs": "[17:14:04] STEP: STEP 2: ...",
  "snapshot": [
    "roger_case_001/screenshots/0002_Clicked_on_Text_....png"
  ]
}
```

- `step_idx`：Agent 步骤编号
- `logs`：该步文本日志（多行用 `\n` 连接）
- `snapshot`：相对 `logs/<task_id>/` 的截图路径列表；无图则为 `[]`

读取截图文件时拼接：`logs/<task_id>/` + `snapshot[i]`  
例：`logs/roger/roger_case_001/screenshots/0002_....png`

### 4.3 reason（失败时）

- **未开归因**或归因跳过：多为**字符串**（Agent 的 `InfTest reason` 原文）
- **已开归因**（`.env` 中 `FAILURE_ATTRIBUTION_ENABLED=1` 且 API 配置完整）：为 **JSON 对象**，常见子结构：
  - `functional`：功能结论、`failure_attribution` 打标、`functional_problem_summary` 等
  - `integration`：集成/数据流分析
  - `screenshots_analysis`：截图与日志对齐说明
  - `issues_found`、`risk_level` 等

判断用例是否通过：看 **`status`**（`pass`/`fail`），不要仅看 HTTP 返回是否 200（批量任务可能部分 case 失败）。

### 4.4 token_consumption

```json
{
  "execution": {
    "model": "glm-4.7",
    "prompt_tokens": 80088,
    "completion_tokens": 4224,
    "total_tokens": 84312,
    "requests": 20
  },
  "failure_attribution": {
    "model": "glm-4.7",
    "prompt_tokens": 4423,
    "completion_tokens": 4402,
    "total_tokens": 8825,
    "requests": 1
  },
  "total": {
    "prompt_tokens": 84511,
    "completion_tokens": 8626,
    "total_tokens": 93137,
    "requests": 21
  },
  "by_step": [
    { "step": 1, "prompt_tokens": 2222, "completion_tokens": 235, "total_tokens": 2457 }
  ]
}
```

- `execution`：用例执行阶段 LLM 用量
- `failure_attribution`：仅失败且归因成功时非零
- `total`：二者合计
- `by_step`：按执行 step 拆分（可选参考）
