#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path


def write_output(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--mode", default="success", choices=["success", "fail", "partial", "timeout"])
    parser.add_argument("--delay-ms", type=int, default=0)
    parser.add_argument("--input-json", default="")
    args = parser.parse_args()

    started = time.time()
    if args.delay_ms > 0:
        time.sleep(args.delay_ms / 1000.0)

    workspace = Path(args.workspace)
    analysis_dir = workspace / "analysis"
    analysis_dir.mkdir(parents=True, exist_ok=True)
    report_path = analysis_dir / "report.md"
    report_json_path = analysis_dir / "report.json"

    report_path.write_text(
        "\n".join(
            [
                f"# InfTest Fake 测试报告",
                "",
                "## 总览",
                "",
                "- 总用例数：2",
                "- 通过：2",
                "- 失败：0",
                "",
                "## 结论",
                "",
                "当前 fake 测试闭环通过。",
                "",
            ],
        ),
    )
    report_json_path.write_text(
        json.dumps({"task_id": args.task_id, "summary": "SUCCESS"}, indent=2) + "\n",
    )

    duration_ms = int((time.time() - started) * 1000)
    out_path = Path(args.output_json)

    if args.mode == "fail":
        write_output(
            out_path,
            {
                "success": False,
                "agent_name": "result_analyzer",
                "status": "FAILED",
                "task_id": args.task_id,
                "artifacts": {},
                "metrics": {"duration_ms": duration_ms},
                "error": {"code": "ANALYSIS_FAILED", "message": "mock failure"},
            },
        )
        return 1

    payload = {
        "success": True,
        "agent_name": "result_analyzer",
        "status": "SUCCESS" if args.mode != "partial" else "PARTIAL",
        "task_id": args.task_id,
        "artifacts": {
            "analysis_report": str(report_path),
            "analysis_report_json": str(report_json_path),
        },
        "metrics": {"duration_ms": duration_ms},
        "error": None,
    }
    write_output(out_path, payload)
    print(f"analyzed {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
