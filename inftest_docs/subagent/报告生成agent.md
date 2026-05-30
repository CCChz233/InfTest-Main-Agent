# 测试报告生成 Agent 使用文档

## 概述

本项目提供了完整的测试报告生成能力，支持从结构化测试日志生成专业的整合测试报告。主要特性：

1. **整合报告**：整合所有用例生成单一报告，按 `test_type` 分段展示
2. **用户指令**：支持通过 `--user-instruction` 参数传递额外指令，影响报告生成的内容和侧重点
3. **缺陷管理**：使用标准化的 `DefectType` 和 `DefectInfo` 结构管理缺陷信息
4. **CLI 调用**：其他 Agent 通过命令行接口调用本 Agent

## CLI 调用接口（供其他 Agent 使用）

### 命令格式

```bash
python run_report.py \
  --customer <客户名称> \
  --project-id <项目ID> \
  --log-file <日志文件路径> \
  --doc <需求文档路径> \
  --output <输出目录> \
  [--user-instruction <用户指令>]
```

### 参数说明

| 参数 | 必需 | 说明 | 示例 |
|------|------|------|------|
| `--customer` | 是 | 客户名称 | `新华` |
| `--project-id` | 否 | 项目ID | `sojourn` |
| `--log-file` | 是 | 测试日志文件路径（JSON格式） | `logs/case_result.json` |
| `--doc` | 是 | 需求文档路径（支持 .docx, .md） | `requirements.docx` |
| `--output` | 是 | 输出目录 | `./output` |
| `--user-instruction` | 否 | 用户额外指令，用于报告生成时补充信息<br>（如特殊说明、关注点等） | `重点关注性能问题` |
| `--force` | 否 | 强制重新生成，忽略检查点 | - |

### 调用示例

```bash
python run_report.py \
  --customer "新华" \
  --project-id "sojourn" \
  --log-file logs/case_result.json \
  --doc requirements.docx \
  --output ./output \
  --user-instruction "重点关注性能问题，突出显示超时用例"
```

**参数说明**：
- `--user-instruction`：可选参数，用于向 LLM 传递额外指令，影响报告生成的内容和侧重点
- 用户指令会作为 `- 用户指令: ...` 嵌入报告生成 prompt 的项目信息区块

**输出**：
- `output/summary/整合测试报告_新华_sojourn.md`
- `output/summary/整合测试报告_新华_sojourn.docx`
- `output/summary/缺陷统计明细_整合_新华_sojourn.json`

### 输出日志格式

执行成功后，会在标准输出打印以下信息：

```
============================================================
报告生成完成
============================================================
开始时间: 2026-05-23 10:30:15
结束时间: 2026-05-23 10:32:45
总耗时: 2分30秒
Token 消耗: 15234
输出目录: output
============================================================

完成
缺陷总数: 3
生成文件:
  - output/summary/整合测试报告_新华_sojourn.md
  - output/summary/缺陷统计明细_整合_新华_sojourn.json
  - output/summary/整合测试报告_新华_sojourn.docx
============================================================
```

### 缺陷统计明细 JSON 格式

`缺陷统计明细_*.json` 文件包含所有缺陷的详细信息。**注意：相同类型下同一问题导致的多个用例失败会被聚合成一个缺陷**。

**数据结构参考 `config.structs.DefectInfo`**，当 DefectInfo 结构有改动时，此输出会自动关联更新。

```json
{
  "customer": "新华",
  "project_id": "sojourn",
  "test_type": "unified",
  "total_cases": 10,
  "passed_cases": 7,
  "failed_cases": 3,
  "total_defects": 2,
  "defects": [
    {
      "title": "输入验证缺失",
      "description": "输入验证不完善，导致异常输入未被正确处理",
      "defect_type": "ASSERTION_FAILED",
      "defect_type_value": 1,
      "defect_type_label": "断言失败",
      "severity": "SERIOUS",
      "case_ids": ["roger_case_002", "roger_case_003", "roger_case_007"],
      "symptom_type": "功能异常",
      "root_type": "code_defect",
      "root_label": "代码缺陷"
    },
    {
      "title": "按钮位置错位",
      "description": "按钮在小屏幕设备上显示位置错位",
      "defect_type": "UI_ABNORMAL",
      "defect_type_value": 4,
      "defect_type_label": "UI异常",
      "severity": "NORMAL",
      "case_ids": ["roger_case_008"],
      "symptom_type": "UI异常",
      "root_type": "ui_defect",
      "root_label": "UI缺陷"
    }
  ]
}
```

**字段说明**（基于 `DefectInfo` 结构）：

**核心字段**（来自 DefectInfo）：
- `title`: 缺陷标题（对应 DefectInfo.title）
- `description`: 缺陷描述（对应 DefectInfo.description）
- `defect_type`: 缺陷类型枚举名称（对应 DefectInfo.defect_type），如 "ASSERTION_FAILED"
- `severity`: 严重程度（对应 DefectInfo.severity），可选值：FATAL/SERIOUS/NORMAL/MINOR
- `case_ids`: 受此缺陷影响的所有用例ID列表（对应 DefectInfo.case_ids）

**扩展字段**：
- `defect_type_value`: 缺陷类型枚举值（1-9）
- `defect_type_label`: 缺陷类型中文标签
- `symptom_type`: 失败症状类型
- `root_type`: 问题根因类型
- `root_label`: 问题根因标签

**缺陷类型枚举**（DefectType）：
- `ASSERTION_FAILED` (1): 断言失败
- `RESPONSE_ABNORMAL` (2): 响应异常
- `PERFORMANCE_TIMEOUT` (3): 性能超时
- `UI_ABNORMAL` (4): UI异常
- `COMPATIBILITY_ISSUE` (5): 兼容性问题
- `DATA_ABNORMAL` (6): 数据异常
- `SCRIPT_EXCEPTION` (7): 脚本异常
- `ENVIRONMENT_ABNORMAL` (8): 环境异常
- `OTHER` (9): 其他

## 输入数据格式

### 日志文件格式（JSON）

日志文件必须是结构化的 JSON 格式，包含以下字段：

```json
{
  "cases": [
    {
      "case_id": "roger_case_001",
      "case_name": "用户登录功能测试",
      "test_type": "functional",
      "functional": {
        "status": "passed",
        "scene": "用户登录",
        "expected_result": "登录成功",
        "actual_result": "登录成功",
        "test_type": "functional"
      }
    },
    {
      "case_id": "roger_case_002",
      "case_name": "输入验证测试",
      "test_type": "functional",
      "functional": {
        "status": "failed",
        "scene": "输入验证",
        "expected_result": "拒绝非法输入",
        "actual_result": "接受了非法输入",
        "test_type": "functional",
        "failure_attribution_rationale": "输入验证逻辑缺失",
        "functional_problem_summary": "输入验证缺失",
        "issues_found": [
          {
            "defect_type": 1,
            "severity": "SERIOUS"
          }
        ]
      }
    }
  ]
}
```

**必需字段**：
- `case_id`: 用例ID
- `case_name`: 用例名称
- `test_type`: 测试类型（functional/integration/smoke）
- `functional`: 功能测试结果对象
  - `status`: 执行状态（passed/failed）
  - `scene`: 测试场景
  - `expected_result`: 预期结果
  - `actual_result`: 实际结果
  - `test_type`: 测试类型（与外层一致）

**失败用例额外必需字段**：
- `failure_attribution_rationale`: 失败原因分析
- `functional_problem_summary`: 问题摘要
- `issues_found`: 问题列表
  - `defect_type`: 缺陷类型（1-9，对应 DefectType 枚举值）
  - `severity`: 严重程度（FATAL/SERIOUS/NORMAL/MINOR）

## 集成指南

### Python 代码调用

```python
import subprocess
import json
from pathlib import Path

def generate_report(
    customer: str,
    project_id: str,
    log_file: Path,
    doc_file: Path,
    output_dir: Path,
    user_instruction: str = "",
) -> dict:
    """调用报告生成 Agent。
    
    Returns:
        包含输出文件路径的字典
    """
    cmd = [
        "python", "run_report.py",
        "--customer", customer,
        "--project-id", project_id,
        "--log-file", str(log_file),
        "--doc", str(doc_file),
        "--output", str(output_dir),
    ]
    
    if user_instruction:
        cmd.extend(["--user-instruction", user_instruction])
    
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        check=True,
    )
    
    # 解析输出，提取文件路径
    output_lines = result.stdout.strip().split('\n')
    files = []
    for line in output_lines:
        if line.strip().startswith('-'):
            files.append(line.strip().lstrip('- '))
    
    return {
        "stdout": result.stdout,
        "files": files,
    }

# 使用示例
result = generate_report(
    customer="新华",
    project_id="sojourn",
    log_file=Path("logs/case_result.json"),
    doc_file=Path("requirements.docx"),
    output_dir=Path("./output"),
    user_instruction="重点关注性能问题",
)

print(f"生成的文件: {result['files']}")
```

### 输出文件解析

```python
import json
from pathlib import Path

def parse_defect_summary(json_path: Path) -> dict:
    """解析缺陷统计明细 JSON。"""
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    return {
        "total_defects": data["total_defects"],
        "total_failed_cases": data["failed_cases"],
        "defects": [
            {
                "title": d["title"],
                "type": d["defect_type_label"],
                "severity": d["severity"],
                "affected_cases": len(d["case_ids"]),
            }
            for d in data["defects"]
        ]
    }

# 使用示例
summary = parse_defect_summary(
    Path("output/summary/缺陷统计明细_整合_新华_sojourn.json")
)
print(f"总缺陷数: {summary['total_defects']}")
for defect in summary["defects"]:
    print(f"  - {defect['title']} ({defect['type']}): 影响 {defect['affected_cases']} 个用例")
```

## 注意事项

1. **相对路径输出**：所有输出文件路径均为相对于当前工作目录的相对路径，便于其他 Agent 解析
2. **缺陷聚合**：相同类型下同一问题导致的多个用例失败会被聚合成一个缺陷，`case_ids` 字段包含所有受影响的用例
3. **用户指令**：用户指令会直接传递给 LLM，影响报告生成的内容和侧重点，建议使用简洁明确的指令

## 故障排查

### 错误：用例缺少预归因数据

```
错误: 用例 roger_case_001 缺少预归因数据
```

**解决方案**：确保输入 JSON 中每个用例都包含完整的 `functional` 字段和失败原因分析。

### 错误：失败用例缺少失败原因分析

```
错误: 发现 3 条失败用例，其中 2 条缺少失败原因分析
```

**解决方案**：为所有失败用例添加 `failure_attribution_rationale` 字段。

## 技术架构

```
run_report.py (CLI 入口)
    ↓
simple_workflow.py (报告生成流程)
    ↓
UnifiedReportAgent (整合报告生成)
    ↓
LLM (报告内容生成)
```

## 联系方式

如有问题或建议，请联系项目维护者。
