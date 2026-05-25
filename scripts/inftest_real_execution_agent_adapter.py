#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def env_bool(name: str, default: str = "false") -> str:
    value = os.environ.get(name, default).strip().lower()
    return "true" if value in {"1", "true", "yes", "on"} else "false"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def find_case_result(workspace: Path, agent_cwd: Path) -> Path | None:
    explicit = os.environ.get("INFTEST_EXECUTION_CASE_RESULT", "").strip()
    candidates = []
    if explicit:
        candidates.append(Path(explicit))
    candidates.extend(
        [
            workspace / "execution" / "results" / "case_result.json",
            agent_cwd / "logs" / "case_result.json",
            agent_cwd / "output" / "case_result.json",
            agent_cwd / "case_result.json",
        ]
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def normalize_status(status: Any) -> str:
    value = str(status).strip().lower()
    if value in {"pass", "passed", "success", "successful"}:
        return "SUCCESS"
    if value in {"fail", "failed", "failure", "error"}:
        return "FAILED"
    return "UNKNOWN"


def write_summary(task_id: str, case_result_path: Path, summary_path: Path) -> None:
    data = read_json(case_result_path)
    cases = data.get("cases", []) if isinstance(data, dict) else []
    passed = 0
    failed = 0
    skipped = 0
    case_results = []
    for case in cases:
        if not isinstance(case, dict):
            continue
        case_id = str(case.get("case_id", f"case_{len(case_results) + 1}"))
        case_results.append(case_id)
        status = normalize_status(case.get("status"))
        if status == "SUCCESS":
            passed += 1
        elif status == "FAILED":
            failed += 1
        else:
            skipped += 1
    total = len(case_results)
    write_json(
        summary_path,
        {
            "task_id": task_id,
            "total": total,
            "passed": passed,
            "failed": failed,
            "skipped": skipped,
            "status": "FAILED" if failed > 0 else "SUCCESS",
            "case_results": case_results,
        },
    )


def build_command(args: argparse.Namespace, device_case_bind: Path) -> list[str]:
    explicit = os.environ.get("INFTEST_EXECUTION_AGENT_COMMAND", "").strip()
    if explicit:
        return shlex.split(explicit) + [
            "--task-id",
            args.task_id,
            "--device-case-bind",
            f"@{device_case_bind}",
        ]

    python_bin = os.environ.get("INFTEST_EXECUTION_AGENT_PYTHON", "python")
    script = os.environ.get("INFTEST_EXECUTION_AGENT_SCRIPT", "run_API.py")
    user_id = os.environ.get("INFTEST_EXECUTION_USER_ID", "u001")
    project_id = os.environ.get("INFTEST_PROJECT_ID", "xh")
    model = os.environ.get("INFTEST_EXECUTION_MODEL", "glm-4.7")
    return [
        python_bin,
        script,
        "execute",
        "--user-id",
        user_id,
        "--project-id",
        project_id,
        "--task-id",
        args.task_id,
        "--device-case-bind",
        f"@{device_case_bind}",
        "--used-model",
        model,
        "--enable-multimodal-assertion",
        env_bool("INFTEST_ENABLE_MULTIMODAL_ASSERTION"),
        "--enable-multimodal-attribution",
        env_bool("INFTEST_ENABLE_MULTIMODAL_ATTRIBUTION"),
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output-json", required=True)
    args = parser.parse_args()

    started = time.time()
    workspace = Path(args.workspace).resolve()
    output_json = Path(args.output_json).resolve()
    logs_dir = workspace / "execution" / "logs"
    results_dir = workspace / "execution" / "results"
    logs_dir.mkdir(parents=True, exist_ok=True)
    results_dir.mkdir(parents=True, exist_ok=True)

    device_case_bind = workspace / "device_scheduling" / "device_case_bind.json"
    if not device_case_bind.exists():
        write_json(
            output_json,
            {
                "success": False,
                "agent_name": "test_executor",
                "status": "FAILED",
                "task_id": args.task_id,
                "artifacts": {},
                "metrics": {"duration_ms": int((time.time() - started) * 1000)},
                "error": {
                    "code": "MISSING_DEVICE_CASE_BIND",
                    "message": f"Missing device case bind: {device_case_bind}",
                },
            },
        )
        return 1

    agent_cwd_value = os.environ.get("INFTEST_EXECUTION_AGENT_CWD", "").strip()
    if not agent_cwd_value:
        write_json(
            output_json,
            {
                "success": False,
                "agent_name": "test_executor",
                "status": "FAILED",
                "task_id": args.task_id,
                "artifacts": {},
                "metrics": {"duration_ms": int((time.time() - started) * 1000)},
                "error": {
                    "code": "MISSING_EXECUTION_AGENT_CWD",
                    "message": "Set INFTEST_EXECUTION_AGENT_CWD to the directory containing run_API.py.",
                },
            },
        )
        return 1

    agent_cwd = Path(agent_cwd_value).resolve()
    if not agent_cwd.exists():
        write_json(
            output_json,
            {
                "success": False,
                "agent_name": "test_executor",
                "status": "FAILED",
                "task_id": args.task_id,
                "artifacts": {},
                "metrics": {"duration_ms": int((time.time() - started) * 1000)},
                "error": {
                    "code": "EXECUTION_AGENT_CWD_NOT_FOUND",
                    "message": f"Execution agent directory not found: {agent_cwd}",
                },
            },
        )
        return 1

    cmd = build_command(args, device_case_bind)
    invocation_path = logs_dir / "real_execution_agent_invocation.json"
    write_json(invocation_path, {"cwd": str(agent_cwd), "argv": cmd})

    proc = subprocess.run(
        cmd,
        cwd=agent_cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    stdout_path = logs_dir / "real_execution_agent.stdout.log"
    stderr_path = logs_dir / "real_execution_agent.stderr.log"
    stdout_path.write_text(proc.stdout, encoding="utf-8")
    stderr_path.write_text(proc.stderr, encoding="utf-8")

    case_result_source = find_case_result(workspace, agent_cwd)
    if proc.returncode != 0:
        write_json(
            output_json,
            {
                "success": False,
                "agent_name": "test_executor",
                "status": "FAILED",
                "task_id": args.task_id,
                "artifacts": {
                    "stdout_log": str(stdout_path),
                    "stderr_log": str(stderr_path),
                    "invocation": str(invocation_path),
                },
                "metrics": {"duration_ms": int((time.time() - started) * 1000)},
                "error": {
                    "code": "EXECUTION_AGENT_FAILED",
                    "message": f"Execution agent exited with code {proc.returncode}.",
                },
            },
        )
        return proc.returncode

    if case_result_source is None:
        write_json(
            output_json,
            {
                "success": False,
                "agent_name": "test_executor",
                "status": "FAILED",
                "task_id": args.task_id,
                "artifacts": {
                    "stdout_log": str(stdout_path),
                    "stderr_log": str(stderr_path),
                    "invocation": str(invocation_path),
                },
                "metrics": {"duration_ms": int((time.time() - started) * 1000)},
                "error": {
                    "code": "CASE_RESULT_NOT_FOUND",
                    "message": "Execution agent finished but case_result.json was not found. Set INFTEST_EXECUTION_CASE_RESULT if it writes elsewhere.",
                },
            },
        )
        return 1

    case_result_path = results_dir / "case_result.json"
    if case_result_source.resolve() != case_result_path.resolve():
        shutil.copyfile(case_result_source, case_result_path)
    summary_path = results_dir / "summary.json"
    write_summary(args.task_id, case_result_path, summary_path)

    write_json(
        output_json,
        {
            "success": True,
            "agent_name": "test_executor",
            "status": "SUCCESS",
            "task_id": args.task_id,
            "artifacts": {
                "case_result": str(case_result_path),
                "execution_summary": str(summary_path),
                "stdout_log": str(stdout_path),
                "stderr_log": str(stderr_path),
                "invocation": str(invocation_path),
            },
            "metrics": {"duration_ms": int((time.time() - started) * 1000)},
            "error": None,
        },
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
