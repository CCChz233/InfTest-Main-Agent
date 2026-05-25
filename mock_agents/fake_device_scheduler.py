#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path


def write_output(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def load_case_ids(workspace: Path) -> list[str]:
    test_cases_path = workspace / "case_generation" / "test_cases.json"
    if not test_cases_path.exists():
        return ["login_normal", "login_wrong_password"]
    data = json.loads(test_cases_path.read_text())
    root = data.get("root") or {}
    children = root.get("children") or []
    ids: list[str] = []
    for child in children:
        if isinstance(child, dict) and child.get("node_id"):
            ids.append(str(child["node_id"]))
    return ids or ["login_normal", "login_wrong_password"]


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
    output_dir = workspace / "device_scheduling"
    output_dir.mkdir(parents=True, exist_ok=True)
    bindings_path = output_dir / "device_bindings.json"

    case_ids = load_case_ids(workspace)
    bindings = {
        "task_id": args.task_id,
        "bindings": [
            {
                "case_id": cid,
                "device_id": "mock-android-001",
                "platform": "android",
                "device_name": "Mock Pixel 7",
                "status": "BOUND",
            }
            for cid in case_ids
        ],
    }
    bindings_path.write_text(json.dumps(bindings, indent=2) + "\n")

    duration_ms = int((time.time() - started) * 1000)
    out_path = Path(args.output_json)

    if args.mode == "fail":
        write_output(
            out_path,
            {
                "success": False,
                "agent_name": "device_scheduler",
                "status": "FAILED",
                "task_id": args.task_id,
                "artifacts": {},
                "metrics": {"duration_ms": duration_ms},
                "error": {"code": "SCHEDULER_FAILED", "message": "mock failure"},
            },
        )
        return 1

    payload = {
        "success": True,
        "agent_name": "device_scheduler",
        "status": "SUCCESS" if args.mode != "partial" else "PARTIAL",
        "task_id": args.task_id,
        "artifacts": {
            "device_bindings": str(bindings_path),
        },
        "metrics": {"duration_ms": duration_ms},
        "error": None,
    }
    write_output(out_path, payload)
    print(f"scheduled {bindings_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
