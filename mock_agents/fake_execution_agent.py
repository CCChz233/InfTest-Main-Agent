#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path


def write_output(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def load_case_ids(workspace: Path) -> list[tuple[str, str]]:
    test_cases_path = workspace / "case_generation" / "test_cases.json"
    if not test_cases_path.exists():
        return [("login_normal", "SUCCESS"), ("login_wrong_password", "SUCCESS")]
    data = json.loads(test_cases_path.read_text())
    root = data.get("root") or {}
    children = root.get("children") or []
    out: list[tuple[str, str]] = []
    for child in children:
        if isinstance(child, dict) and child.get("node_id"):
            out.append((str(child["node_id"]), "SUCCESS"))
    return out or [("login_normal", "SUCCESS")]


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
    results_dir = workspace / "execution" / "results"
    logs_dir = workspace / "execution" / "logs"
    results_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    cases = load_case_ids(workspace)
    reported: list[str] = []

    for case_id, status in cases:
        log_path = logs_dir / f"{case_id}.log"
        log_path.write_text(f"mock log for {case_id}\n")
        case_path = results_dir / f"case_{case_id}.json"
        case_path.write_text(
            json.dumps(
                {
                    "case_id": case_id,
                    "status": status,
                    "duration_ms": 1500,
                    "device_id": "mock-android-001",
                    "failure_reason": None,
                    "artifacts": {"log_file": str(log_path)},
                },
                indent=2,
            )
            + "\n",
        )
        reported.append(f"case_{case_id}.json")

    summary_path = results_dir / "summary.json"
    summary_path.write_text(
        json.dumps(
            {
                "task_id": args.task_id,
                "total": len(cases),
                "passed": len(cases),
                "failed": 0,
                "skipped": 0,
                "status": "SUCCESS",
                "case_results": reported,
            },
            indent=2,
        )
        + "\n",
    )

    duration_ms = int((time.time() - started) * 1000)
    out_path = Path(args.output_json)

    if args.mode == "fail":
        write_output(
            out_path,
            {
                "success": False,
                "agent_name": "test_executor",
                "status": "FAILED",
                "task_id": args.task_id,
                "artifacts": {},
                "metrics": {"duration_ms": duration_ms},
                "error": {"code": "EXECUTION_FAILED", "message": "mock failure"},
            },
        )
        return 1

    payload = {
        "success": True,
        "agent_name": "test_executor",
        "status": "SUCCESS" if args.mode != "partial" else "PARTIAL",
        "task_id": args.task_id,
        "artifacts": {
            "execution_summary": str(summary_path),
            "execution_results_dir": str(results_dir),
        },
        "metrics": {"duration_ms": duration_ms},
        "error": None,
    }
    write_output(out_path, payload)
    print(f"executed {len(cases)} cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
