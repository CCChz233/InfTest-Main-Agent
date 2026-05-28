#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def default_requirement_doc() -> Path:
    return REPO_ROOT / "inftest_docs" / "Kongming（孔明）—— AI 原生质量OS (1).docx"


def find_first(patterns: list[str], root: Path) -> Path | None:
    for pattern in patterns:
        found = sorted(root.glob(pattern))
        if found:
            return found[0]
    return None


def error_tail(*values: str, limit: int = 800) -> str:
    text = "\n".join(value.strip() for value in values if value and value.strip())
    if not text:
        return ""
    return text[-limit:]


def build_command(log_file: Path, output_dir: Path) -> tuple[list[str], Path | None]:
    agent_cwd_value = os.environ.get("INFTEST_REPORT_AGENT_CWD", "").strip()
    if not agent_cwd_value:
        return [], None
    agent_cwd = Path(agent_cwd_value).resolve()
    python_bin = os.environ.get("INFTEST_REPORT_AGENT_PYTHON", "python")
    script = os.environ.get("INFTEST_REPORT_AGENT_SCRIPT", "run_report.py")
    customer = os.environ.get("INFTEST_REPORT_CUSTOMER", "新华")
    project_id = os.environ.get("INFTEST_PROJECT_ID", "xh")
    requirement_doc = Path(
        os.environ.get("INFTEST_REQUIREMENT_DOC", str(default_requirement_doc()))
    ).resolve()

    cmd = [
        python_bin,
        script,
        "--customer",
        customer,
        "--project-id",
        project_id,
        "--log-file",
        str(log_file),
        "--doc",
        str(requirement_doc),
        "--output",
        str(output_dir),
    ]
    test_type = os.environ.get("INFTEST_REPORT_TEST_TYPE", "").strip()
    if test_type:
        cmd.extend(["--test-type", test_type])
    return cmd, agent_cwd


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output-json", required=True)
    args = parser.parse_args()

    started = time.time()
    workspace = Path(args.workspace).resolve()
    output_json = Path(args.output_json).resolve()
    logs_dir = workspace / "analysis" / "logs"
    analysis_dir = workspace / "analysis"
    output_dir = analysis_dir / "report_agent_output"
    logs_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    log_file = workspace / "execution" / "results" / "case_result.json"
    if not log_file.exists():
        write_json(
            output_json,
            {
                "success": False,
                "agent_name": "result_analyzer",
                "status": "FAILED",
                "task_id": args.task_id,
                "artifacts": {},
                "metrics": {"duration_ms": int((time.time() - started) * 1000)},
                "error": {
                    "code": "MISSING_CASE_RESULT",
                    "message": f"Missing report input: {log_file}",
                },
            },
        )
        return 1

    cmd, agent_cwd = build_command(log_file, output_dir)
    if agent_cwd is None or not cmd:
        write_json(
            output_json,
            {
                "success": False,
                "agent_name": "result_analyzer",
                "status": "FAILED",
                "task_id": args.task_id,
                "artifacts": {},
                "metrics": {"duration_ms": int((time.time() - started) * 1000)},
                "error": {
                    "code": "MISSING_REPORT_AGENT_CWD",
                    "message": "Set INFTEST_REPORT_AGENT_CWD to the directory containing run_report.py.",
                },
            },
        )
        return 1
    if not agent_cwd.exists():
        write_json(
            output_json,
            {
                "success": False,
                "agent_name": "result_analyzer",
                "status": "FAILED",
                "task_id": args.task_id,
                "artifacts": {},
                "metrics": {"duration_ms": int((time.time() - started) * 1000)},
                "error": {
                    "code": "REPORT_AGENT_CWD_NOT_FOUND",
                    "message": f"Report agent directory not found: {agent_cwd}",
                },
            },
        )
        return 1

    invocation_path = logs_dir / "real_report_agent_invocation.json"
    write_json(invocation_path, {"cwd": str(agent_cwd), "argv": cmd})
    proc = subprocess.run(
        cmd,
        cwd=agent_cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    stdout_path = logs_dir / "real_report_agent.stdout.log"
    stderr_path = logs_dir / "real_report_agent.stderr.log"
    stdout_path.write_text(proc.stdout, encoding="utf-8")
    stderr_path.write_text(proc.stderr, encoding="utf-8")

    if proc.returncode != 0:
        detail = error_tail(proc.stderr, proc.stdout)
        message = f"Report agent exited with code {proc.returncode}."
        if detail:
            message = f"{message} {detail}"
        write_json(
            output_json,
            {
                "success": False,
                "agent_name": "result_analyzer",
                "status": "FAILED",
                "task_id": args.task_id,
                "artifacts": {
                    "stdout_log": str(stdout_path),
                    "stderr_log": str(stderr_path),
                    "invocation": str(invocation_path),
                },
                "metrics": {"duration_ms": int((time.time() - started) * 1000)},
                "error": {
                    "code": "REPORT_AGENT_FAILED",
                    "message": message,
                },
            },
        )
        return proc.returncode

    markdown_report = find_first(["summary/*.md", "**/*.md"], output_dir)
    docx_report = find_first(["summary/*.docx", "**/*.docx"], output_dir)
    if markdown_report is None:
        write_json(
            output_json,
            {
                "success": False,
                "agent_name": "result_analyzer",
                "status": "FAILED",
                "task_id": args.task_id,
                "artifacts": {
                    "stdout_log": str(stdout_path),
                    "stderr_log": str(stderr_path),
                    "invocation": str(invocation_path),
                    "report_output_dir": str(output_dir),
                },
                "metrics": {"duration_ms": int((time.time() - started) * 1000)},
                "error": {
                    "code": "REPORT_MARKDOWN_NOT_FOUND",
                    "message": f"Report agent finished but no markdown report was found under {output_dir}.",
                },
            },
        )
        return 1

    canonical_report = analysis_dir / "report.md"
    shutil.copyfile(markdown_report, canonical_report)
    artifacts = {
        "analysis_report": str(canonical_report),
        "report_output_dir": str(output_dir),
        "stdout_log": str(stdout_path),
        "stderr_log": str(stderr_path),
        "invocation": str(invocation_path),
    }
    if docx_report is not None:
        artifacts["analysis_report_docx"] = str(docx_report)

    write_json(
        output_json,
        {
            "success": True,
            "agent_name": "result_analyzer",
            "status": "SUCCESS",
            "task_id": args.task_id,
            "artifacts": artifacts,
            "metrics": {"duration_ms": int((time.time() - started) * 1000)},
            "error": None,
        },
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
