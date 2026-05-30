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


def _parse_case_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        cases = payload.get("cases")
        if isinstance(cases, list):
            return [row for row in cases if isinstance(row, dict)]
        if "case_id" in payload or "task_id" in payload or "case_index" in payload:
            return [payload]
    return []


def _normalize_snapshot(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [part.strip() for part in value.split(",") if part.strip()]
    return []


def _normalize_steps_info(steps: Any) -> list[dict[str, Any]]:
    if not isinstance(steps, list):
        return []
    out: list[dict[str, Any]] = []
    for index, item in enumerate(steps):
        if not isinstance(item, dict):
            continue
        step_idx = int(item.get("step_idx") or item.get("step") or index + 1)
        logs = str(item.get("logs") or "").strip()
        snapshot = _normalize_snapshot(item.get("snapshot"))
        status_raw = str(item.get("status") or "").strip().lower()
        status = "failed" if status_raw in ("fail", "failed", "failure") else "passed"
        out.append(
            {
                "step": step_idx,
                "logs": logs,
                "snapshot": snapshot,
                "status": status,
            }
        )
    return out


def _numeric_case_id(row: dict[str, Any], fallback: int) -> int:
    case_index = row.get("case_index")
    if isinstance(case_index, int) and case_index > 0:
        return case_index
    raw = row.get("case_id")
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str) and raw.strip().isdigit():
        return int(raw.strip())
    return fallback


def build_report_task_log_array(payload: Any, task_id: str) -> list[dict[str, Any]]:
    rows = _parse_case_rows(payload)
    out: list[dict[str, Any]] = []
    for index, row in enumerate(rows, 1):
        case_id = _numeric_case_id(row, index)
        status = str(row.get("status") or "pass").strip().lower()
        if status not in ("pass", "fail", "failed"):
            exec_result = str(row.get("execution_result") or "").strip().upper()
            status = "pass" if exec_result in ("SUCCESS", "PASS", "PASSED", "COMPLETION") else "fail"
        out.append(
            {
                "task_id": str(row.get("task_id") or task_id),
                "case_index": case_id,
                "case_id": case_id,
                "case_name": str(
                    row.get("case_name") or row.get("case_step") or f"案例{case_id}"
                ),
                "test_type": str(row.get("test_type") or "functional"),
                "case_step": str(row.get("case_step") or ""),
                "expected_result": row.get("expected_result")
                if isinstance(row.get("expected_result"), list)
                else [],
                "status": "pass" if status in ("pass", "passed", "success") else "fail",
                "device_id": row.get("device_id"),
                "start_time": row.get("start_time"),
                "end_time": row.get("end_time"),
                "retry_count": row.get("retry_count") or 0,
                "failure_reason": str(row.get("failure_reason") or ""),
                "steps_info": _normalize_steps_info(
                    row.get("steps_info") or row.get("step_log_info")
                ),
                "reason": str(row.get("reason") or ""),
                "time": str(row.get("time") or ""),
                "device": row.get("device"),
                "token_consumption": row.get("token_consumption"),
            }
        )
    return out


def resolve_report_log_file(workspace: Path, task_id: str) -> Path:
    results_dir = workspace / "execution" / "results"
    report_log = results_dir / "report_task_log.json"
    if report_log.exists():
        return report_log

    case_result = results_dir / "case_result.json"
    if not case_result.exists():
        return case_result

    try:
        payload = json.loads(case_result.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return case_result

    converted = build_report_task_log_array(payload, task_id)
    if not converted:
        return case_result

    report_log.write_text(
        json.dumps(converted, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return report_log


def resolve_requirement_doc(workspace: Path) -> Path:
    report_requirement_path = workspace / "input" / "report_requirement.json"
    if report_requirement_path.exists():
        try:
            payload = json.loads(report_requirement_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = {}
        if isinstance(payload, dict):
            md_file_key = str(payload.get("md_file_key", "")).strip()
            if md_file_key:
                if md_file_key.startswith("http://") or md_file_key.startswith("https://"):
                    try:
                        import urllib.request

                        target = workspace / "input" / "requirement.md"
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with urllib.request.urlopen(md_file_key, timeout=30) as response:
                            target.write_bytes(response.read())
                        return target.resolve()
                    except Exception:
                        pass
                candidate = Path(md_file_key)
                if candidate.exists():
                    return candidate.resolve()

    return Path(
        os.environ.get("INFTEST_REQUIREMENT_DOC", str(default_requirement_doc()))
    ).resolve()


def load_user_instruction_text(workspace: Path) -> str:
    path = workspace / "input" / "user_instruction.json"
    if path.exists():
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = None
        if isinstance(payload, dict):
            instruction = str(payload.get("user_instruction") or "").strip()
            qa_list = payload.get("plan_qa_list")
            parts = [instruction] if instruction else []
            if isinstance(qa_list, list):
                for item in qa_list:
                    if not isinstance(item, dict):
                        continue
                    question = str(item.get("question") or "").strip()
                    answer = str(item.get("answer") or "").strip()
                    if question or answer:
                        parts.append(f"参考问答 - 问: {question} 答: {answer}")
            text = "\n".join(parts).strip()
            if text:
                return text
    return os.environ.get("INFTEST_USER_INSTRUCTION", "").strip()


def build_command(
    log_file: Path,
    output_dir: Path,
    workspace: Path,
    user_instruction: str = "",
) -> tuple[list[str], Path | None]:
    agent_cwd_value = os.environ.get("INFTEST_REPORT_AGENT_CWD", "").strip()
    if not agent_cwd_value:
        return [], None
    agent_cwd = Path(agent_cwd_value).resolve()
    python_bin = os.environ.get("INFTEST_REPORT_AGENT_PYTHON", "python")
    script = os.environ.get("INFTEST_REPORT_AGENT_SCRIPT", "run_report.py")
    customer = os.environ.get("INFTEST_REPORT_CUSTOMER", "新华")
    project_id = os.environ.get("INFTEST_PROJECT_ID", "xh")
    requirement_doc = resolve_requirement_doc(workspace)

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
    if user_instruction:
        cmd.extend(["--user-instruction", user_instruction])
    return cmd, agent_cwd


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--user-instruction", default="")
    args = parser.parse_args()

    started = time.time()
    workspace = Path(args.workspace).resolve()
    output_json = Path(args.output_json).resolve()
    logs_dir = workspace / "analysis" / "logs"
    analysis_dir = workspace / "analysis"
    output_dir = analysis_dir / "report_agent_output"
    logs_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    case_result = workspace / "execution" / "results" / "case_result.json"
    if not case_result.exists():
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
                    "message": f"Missing report input: {case_result}",
                },
            },
        )
        return 1

    log_file = resolve_report_log_file(workspace, args.task_id)
    user_instruction = args.user_instruction.strip() or load_user_instruction_text(workspace)
    cmd, agent_cwd = build_command(log_file, output_dir, workspace, user_instruction)
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
