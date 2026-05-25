#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path


def write_output(
    path: Path,
    *,
    success: bool,
    status: str,
    task_id: str,
    artifacts: dict,
    duration_ms: int,
    error: dict | None,
) -> None:
    payload = {
        "success": success,
        "agent_name": "test_generation",
        "status": status,
        "task_id": task_id,
        "artifacts": artifacts,
        "metrics": {"duration_ms": duration_ms, "total_tokens": 0},
        "error": error,
    }
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
    case_dir = workspace / "case_generation"
    case_dir.mkdir(parents=True, exist_ok=True)

    test_cases_path = case_dir / "test_cases.json"
    test_cases = {
        "root": {
            "node_id": "root",
            "title": "登录模块测试",
            "children": [
                {
                    "node_id": "login_normal",
                    "title": "账号密码正常登录",
                    "type": "CASE",
                    "preconditions": ["用户已注册"],
                    "test_steps": [
                        "打开登录页",
                        "输入正确账号",
                        "输入正确密码",
                        "点击登录",
                    ],
                    "expected_result": "登录成功，进入首页",
                },
                {
                    "node_id": "login_wrong_password",
                    "title": "错误密码登录",
                    "type": "CASE",
                    "preconditions": ["用户已注册"],
                    "test_steps": [
                        "打开登录页",
                        "输入正确账号",
                        "输入错误密码",
                        "点击登录",
                    ],
                    "expected_result": "提示账号或密码错误",
                },
            ],
        }
    }
    test_cases_path.write_text(json.dumps(test_cases, indent=2) + "\n")

    duration_ms = int((time.time() - started) * 1000)
    out_path = Path(args.output_json)

    if args.mode == "fail":
        write_output(
            out_path,
            success=False,
            status="FAILED",
            task_id=args.task_id,
            artifacts={},
            duration_ms=duration_ms,
            error={"code": "CASE_GENERATION_FAILED", "message": "mock failure"},
        )
        print("failed (mock)")
        return 1

    if args.mode == "timeout":
        write_output(
            out_path,
            success=False,
            status="FAILED",
            task_id=args.task_id,
            artifacts={},
            duration_ms=duration_ms,
            error={"code": "TIMEOUT", "message": "mock timeout"},
        )
        print("timeout (mock)")
        return 124

    write_output(
        out_path,
        success=True,
        status="SUCCESS" if args.mode != "partial" else "PARTIAL",
        task_id=args.task_id,
        artifacts={"test_cases": str(test_cases_path), "result": str(out_path)},
        duration_ms=duration_ms,
        error=None,
    )
    print(f"generated {test_cases_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
