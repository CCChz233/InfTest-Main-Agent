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


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def should_use_file_api_mode(agent_cwd: Path, script: str) -> bool:
    mode = os.environ.get("INFTEST_EXECUTION_AGENT_MODE", "").strip().lower()
    if mode in {"file_api", "run_api_file", "run-testcase-file"}:
        return True
    if mode in {"execute", "legacy_execute"}:
        return False
    script_path = agent_cwd / script
    if not script_path.exists():
        return False
    try:
        script_text = script_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return False
    return "run-testcase-file" in script_text and "--case" in script_text


def should_use_mock_mode() -> bool:
    mode = os.environ.get("INFTEST_EXECUTION_AGENT_MODE", "").strip().lower()
    if mode in {"mock", "mock_data", "mock_result"}:
        return True
    return os.environ.get("INFTEST_EXECUTION_MOCK", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def is_real_only_mode() -> bool:
    return os.environ.get("INFTEST_REAL_ONLY", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def iter_device_bound_cases(device_case_bind: Path) -> list[dict[str, Any]]:
    data = read_json(device_case_bind)
    device_case = data.get("device_case", {}) if isinstance(data, dict) else {}
    cases: list[dict[str, Any]] = []
    if isinstance(device_case, dict):
        for index, case in enumerate(device_case.values(), 1):
            if not isinstance(case, dict):
                continue
            case_id = str(case.get("case_id") or f"case_{index:03d}")
            cases.append(
                {
                    "case_id": case_id,
                    "case_name": str(case.get("case_name") or case.get("test_scenario") or case_id),
                    "case_function_point": str(case.get("case_function_point") or "未分类功能点"),
                    "test_scenario": str(case.get("test_scenario") or "默认场景"),
                    "case_step": case.get("case_step", []),
                    "expected_result": case.get("expected_result", []),
                }
            )
    return cases


def build_case_file_from_device_bind(device_case_bind: Path, case_file: Path) -> Path:
    cases = iter_device_bound_cases(device_case_bind)
    lines: list[str] = []
    for case_index, case in enumerate(cases, 1):
        steps = case.get("case_step", [])
        expected = case.get("expected_result", [])
        if isinstance(steps, list):
            step_text = "，".join(str(step) for step in steps)
        else:
            step_text = str(steps)
        if isinstance(expected, list):
            expected_text = "，".join(str(item) for item in expected)
        else:
            expected_text = str(expected)
        lines.append(f"案例{case_index}操作步骤：{step_text}")
        lines.append(f"案例{case_index}预期结果：{expected_text}")
    if not lines:
        raise ValueError(f"No executable cases found in {device_case_bind}")
    write_text(case_file, "\n".join(lines) + "\n")
    return case_file


def normalize_lines(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value]
    if value is None:
        return []
    return [str(value)]


def build_mock_case_result(task_id: str, device_case_bind: Path) -> dict[str, Any]:
    cases = iter_device_bound_cases(device_case_bind)
    if not cases:
        raise ValueError(f"No executable cases found in {device_case_bind}")

    rows: list[dict[str, Any]] = []
    for index, case in enumerate(cases, 1):
        steps = normalize_lines(case.get("case_step"))
        expected = normalize_lines(case.get("expected_result"))
        expected_text = "；".join(expected) if expected else "预期结果通过"
        rows.append(
            {
                "task_id": task_id,
                "case_index": index,
                "case_id": case["case_id"],
                "case_name": case["case_name"],
                "test_type": "functional",
                "case_step": "\n".join(steps),
                "expected_result": expected,
                "status": "pass",
                "steps_info": [
                    {
                        "step": step_index,
                        "logs": f"mock execution step passed: {step}",
                        "snapshot": "",
                        "status": "passed",
                    }
                    for step_index, step in enumerate(steps, 1)
                ],
                "functional": {
                    "status": "passed",
                    "test_type": "functional",
                    "scene": case["test_scenario"],
                    "expected_result": expected_text,
                    "actual_result": "Mock execution completed successfully.",
                    "failure_attribution": "",
                    "failure_attribution_rationale": "",
                    "failure_attribution_confidence": "",
                    "issue_root_type": "",
                    "issue_root_type_label": "",
                    "functional_problem_summary": "",
                    "failure_symptom_type": "",
                },
                "screenshots_analysis": [],
                "issues_found": [],
                "risk_level": "low",
            }
        )
    return {"cases": rows}


def find_case_result(workspace: Path, agent_cwd: Path, stdout: str = "") -> Path | None:
    explicit = os.environ.get("INFTEST_EXECUTION_CASE_RESULT", "").strip()
    candidates = []
    if explicit:
        candidates.append(Path(explicit))
    _, response_body = extract_run_api_response(stdout)
    if response_body:
        for key in ("case_result_path", "structured_json_path"):
            value = response_body.get(key)
            if isinstance(value, str) and value.strip():
                candidates.append(Path(value.strip()))
        case_results = response_body.get("case_results")
        if isinstance(case_results, list):
            for case_result in case_results:
                if not isinstance(case_result, dict):
                    continue
                value = case_result.get("case_result_path")
                if isinstance(value, str) and value.strip():
                    candidates.append(Path(value.strip()))
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


def extract_run_api_response(stdout: str) -> tuple[int | None, dict[str, Any] | None]:
    status_code: int | None = None
    response_body: dict[str, Any] | None = None
    for raw_line in stdout.splitlines():
        line = raw_line.strip()
        if line.startswith("状态码："):
            try:
                status_code = int(line.split("：", 1)[1].strip())
            except ValueError:
                status_code = None
            continue
        if line.startswith("返回结果："):
            raw_json = line.split("：", 1)[1].strip()
            try:
                parsed = json.loads(raw_json)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                response_body = parsed
    return status_code, response_body


def run_api_failure_message(stdout: str) -> str | None:
    status_code, response_body = extract_run_api_response(stdout)
    if response_body and response_body.get("success") is False:
        error = response_body.get("error") or response_body.get("message")
        if error:
            prefix = f"Execution API returned HTTP {status_code}: " if status_code else ""
            return f"{prefix}{error}"
        if status_code and status_code >= 400:
            return f"Execution API returned HTTP {status_code} with success=false."
        return "Execution API returned success=false."
    if status_code and status_code >= 400:
        return f"Execution API returned HTTP {status_code}."
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
    if isinstance(data, dict):
        cases = data.get("cases", [])
    elif isinstance(data, list):
        cases = data
    else:
        cases = []
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


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


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
                        parts.append(f"Q: {question}\nA: {answer}")
            text = "\n\n".join(parts).strip()
            if text:
                return text
    return os.environ.get("INFTEST_USER_INSTRUCTION", "").strip()


def build_command(
    args: argparse.Namespace,
    device_case_bind: Path,
    workspace: Path,
    agent_cwd: Path,
    user_payload: str = "",
) -> list[str]:
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
    if should_use_file_api_mode(agent_cwd, script):
        case_file = build_case_file_from_device_bind(
            device_case_bind,
            workspace / "execution" / "inputs" / "test_cases.md",
        )
        cmd = [
            python_bin,
            script,
            "--case",
            str(case_file),
            "--json",
            str(workspace / "execution" / "results" / "case_result.json"),
        ]
        if user_payload:
            cmd.extend(["--user-payload", user_payload])
        return cmd

    user_id = os.environ.get("INFTEST_EXECUTION_USER_ID", "u001")
    project_id = os.environ.get("INFTEST_PROJECT_ID", "xh")
    model = os.environ.get("INFTEST_EXECUTION_MODEL", "glm-4.7")
    cmd = [
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
    if user_payload:
        cmd.extend(["--user-payload", user_payload])
    return cmd


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--user-payload", default="")
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

    if should_use_mock_mode():
        if is_real_only_mode():
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
                        "code": "REAL_ONLY_DISALLOW_EXECUTION_MOCK",
                        "message": "INFTEST_REAL_ONLY is enabled, execution mock mode is forbidden.",
                    },
                },
            )
            return 1
        invocation_path = logs_dir / "real_execution_agent_invocation.json"
        stdout_path = logs_dir / "real_execution_agent.stdout.log"
        stderr_path = logs_dir / "real_execution_agent.stderr.log"
        case_result_path = results_dir / "case_result.json"
        summary_path = results_dir / "summary.json"
        try:
            write_json(case_result_path, build_mock_case_result(args.task_id, device_case_bind))
            write_summary(args.task_id, case_result_path, summary_path)
        except Exception as error:
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
                        "code": "MOCK_EXECUTION_FAILED",
                        "message": str(error),
                    },
                },
            )
            return 1

        write_json(
            invocation_path,
            {
                "mode": "mock",
                "cwd": None,
                "argv": [],
                "device_case_bind": str(device_case_bind),
            },
        )
        stdout_path.write_text(
            f"mock execution generated {case_result_path}\n",
            encoding="utf-8",
        )
        stderr_path.write_text("", encoding="utf-8")
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

    cmd = build_command(
        args,
        device_case_bind,
        workspace,
        agent_cwd,
        user_payload=args.user_payload.strip() or load_user_instruction_text(workspace),
    )
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

    run_api_error = run_api_failure_message(proc.stdout)
    if run_api_error is not None:
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
                    "code": "EXECUTION_AGENT_API_FAILED",
                    "message": run_api_error,
                },
            },
        )
        return 1

    case_result_source = find_case_result(workspace, agent_cwd, proc.stdout)
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
