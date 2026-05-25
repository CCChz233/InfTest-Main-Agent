# 测试报告生成 Agent 使用文档

## 概述

本项目提供了完整的测试报告生成能力，支持从结构化测试日志生成专业的测试报告。主要特性：

1. **按测试类型筛选**：支持按 `test_type`（functional/integration/smoke）筛选用例生成单份报告
2. **整合报告**：当不指定 `test_type` 时，整合所有用例生成单一报告，按 `test_type` 分段展示
3. **缺陷管理**：使用标准化的 `DefectType` 和 `DefectInfo` 结构管理缺陷信息

## 快速开始

### 1. 命令行使用

```bash
# 生成整合报告（所有用例，按 test_type 分段）
python run_report.py \
  --customer "新华" \
  --project-id "sojourn" \
  --log-file logs/case_result.json \
  --doc requirements.docx \
  --output ./output

# 生成功能测试报告（仅 functional 类型用例）
python run_report.py \
  --customer "新华" \
  --project-id "sojourn" \
  --test-type functional \
  --log-file logs/case_result.json \
  --doc requirements.docx \
  --output ./output

# 生成集成测试报告（仅 integration 类型用例）
python run_report.py \
  --customer "新华" \
  --project-id "sojourn" \
  --test-type integration \
  --log-file logs/case_result.json \
  --doc requirements.docx \
  --output ./output
```

### 2. 在其他 Agent 中调用

```python
from pathlib import Path
from models.schemas import ModelConfig, TestContext
from skills.report_agent_skill import ReportAgentSkill

# 初始化配置
config = ModelConfig(
    api_key="your-api-key",
    base_url="https://api.example.com",
    model="gpt-4",
    reasoning_effort="medium"
)

# 创建技能实例
skill = ReportAgentSkill(config)

# 准备测试上下文
context = TestContext(
    customer="新华",
    project_id="sojourn",
    requirement=requirement_doc,
    cases=cases,
    logs=logs,
    config=config,
    scenario_rows=scenarios,
    logs_source_dir=Path("logs"),
)

# 方式1: 生成整合报告（推荐用于全量测试）
result = await skill.generate_unified_report(
    context=context,
    output_dir=Path("./output"),
    force=False
)
print(f"整合报告: {result['unified_report']}")
print(f"缺陷总数: {result['defect_summary']['total_defects']}")

# 方式2: 生成筛选报告（推荐用于单一测试类型）
result = await skill.generate_filtered_report(
    context=context,
    test_type="functional",  # 或 "integration", "smoke"
    output_dir=Path("./output"),
    force=False
)
print(f"功能测试报告: {result['report']}")
print(f"筛选后用例数: {len(result['case_results'])}")

# 方式3: 生成所有类型报告（不推荐，除非确实需要三份报告）
result = await skill.generate_all_reports(
    context=context,
    output_dir=Path("./output"),
    force=False
)
print(f"功能测试报告: {result['functional_report']}")
print(f"集成测试报告: {result['integration_report']}")
print(f"冒烟测试报告: {result['smoke_report']}")
```

## 输入文件格式

### case_result.json 结构

```json
{
  "cases": [
    {
      "task_id": "roger",
      "case_index": 1,
      "case_id": "roger_case_001",
      "case_name": "常规搜索流程",
      "test_type": "functional",  // 必需字段：functional/integration/smoke
      "case_step": "测试步骤描述",
      "expected_result": ["预期结果1", "预期结果2"],
      "status": "fail",
      "steps_info": [...],
      "functional": {
        "status": "failed",
        "test_type": "functional",
        "failure_attribution": "...",
        "failure_attribution_rationale": "..."
      },
      "screenshots_analysis": [...],
      "issues_found": [
        {
          "severity": "medium",
          "description": "缺陷描述",
          "defect_type": 8,  // DefectType 枚举值（1-9）
          "suggestion": "修复建议"
        }
      ],
      "risk_level": "medium"
    }
  ]
}
```

## 缺陷类型 (DefectType)

本项目使用标准化的缺陷类型枚举：

| 枚举值 | 枚举名称 | 中文标签 | 说明 |
|--------|----------|----------|------|
| 1 | ASSERTION_FAILED | 断言失败 | 实际结果与预期结果不一致 |
| 2 | RESPONSE_ERROR | 响应异常 | 接口/页面响应异常（4xx、5xx、空响应、格式错误） |
| 3 | PERFORMANCE_TIMEOUT | 性能超时 | 性能或超时问题 |
| 4 | UI_ABNORMAL | UI异常 | UI展示异常、样式错位、交互异常 |
| 5 | COMPATIBILITY_ISSUE | 兼容性问题 | 浏览器、设备、系统差异 |
| 6 | DATA_ERROR | 数据异常 | 数据缺失、重复、计算错误、状态不一致 |
| 7 | SCRIPT_ERROR | 脚本异常 | 测试脚本/用例执行异常 |
| 8 | ENVIRONMENT_ERROR | 环境异常 | 测试环境异常（服务不可用、依赖异常、配置错误） |
| 9 | OTHER | 其他 | 其他类型 |

**注意**：输入文件中的 `defect_type` 字段应直接使用上述枚举值（1-9），本项目不再进行映射转换。

## 输出文件

### 整合报告模式（无 --test-type）

```
output/
├── .checkpoint/
│   └── unified.txt          # 检查点文件
└── summary/
    ├── 整合测试报告_新华_sojourn.md
    ├── 整合测试报告_新华_sojourn.docx
    └── 用例处理明细_整合_新华_sojourn.docx
```

### 筛选报告模式（有 --test-type）

```
output/
├── .checkpoint/
│   └── functional.txt       # 检查点文件
└── summary/
    ├── 功能测试报告_新华_sojourn.md
    ├── 功能测试报告_新华_sojourn.docx
    └── 用例处理明细_functional_新华_sojourn.docx
```

## API 参考

### ReportAgentSkill

#### `generate_unified_report(context, output_dir, force)`

生成整合测试报告（所有用例，按 test_type 分段展示）。

**参数**：
- `context` (TestContext): 测试上下文
- `output_dir` (Path | None): 输出目录，用于存储检查点
- `force` (bool): 是否强制重新生成，忽略检查点

**返回**：
```python
{
    "unified_report": str,           # 整合报告 Markdown
    "case_results": list[CaseAnalysisResult],  # 用例结果列表
    "defect_summary": dict           # 缺陷汇总
}
```

#### `generate_filtered_report(context, test_type, output_dir, force)`

生成筛选后的测试报告（按 test_type 筛选用例）。

**参数**：
- `context` (TestContext): 测试上下文
- `test_type` (str): 测试类型（functional/integration/smoke）
- `output_dir` (Path | None): 输出目录
- `force` (bool): 是否强制重新生成

**返回**：
```python
{
    "report": str,                   # 测试报告 Markdown
    "report_type": str,              # 报告类型
    "case_results": list[CaseAnalysisResult],  # 筛选后的用例列表
    "defect_summary": dict           # 缺陷汇总
}
```

#### `generate_all_reports(context, output_dir, force)`

生成所有类型的测试报告（功能/集成/冒烟）。

**注意**：此方法不筛选用例，会为每种报告类型使用所有用例。

**返回**：
```python
{
    "functional_report": str,        # 功能测试报告
    "integration_report": str,       # 集成测试报告
    "smoke_report": str,             # 冒烟测试报告
    "case_results": list[CaseAnalysisResult],
    "defect_summary": dict
}
```

## 最佳实践

1. **使用整合报告**：当需要全面了解所有测试类型的执行情况时，使用整合报告模式
2. **使用筛选报告**：当只关注特定测试类型时，使用筛选报告模式
3. **检查点机制**：利用检查点机制避免重复生成，节省时间和成本
4. **缺陷类型标准化**：确保输入文件中的 `defect_type` 使用标准枚举值（1-9）
5. **失败原因分析**：确保所有失败用例都包含 `failure_attribution_rationale` 字段

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

### 错误：test_type 必须是 functional/integration/smoke 之一

```
ValueError: test_type 必须是 functional/integration/smoke 之一，当前: unknown
```

**解决方案**：检查输入文件中的 `test_type` 字段，确保值为 functional、integration 或 smoke。

## 更新日志

### v2.0.0 (2026-05-22)

- ✨ 新增整合报告模式，支持按 test_type 分段展示
- ✨ 新增按 test_type 筛选用例功能
- ✨ 新增 ReportAgentSkill 供外部 Agent 调用
- 🔧 使用标准化的 DefectType 和 DefectInfo 结构
- 🔧 移除缺陷类型映射逻辑，直接使用输入文件中的类型
- 📝 完善文档和使用示例

## 联系方式

如有问题或建议，请联系项目维护者。
