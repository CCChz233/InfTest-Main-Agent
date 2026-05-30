#!/usr/bin/env python3
"""Adapter bridging InfTest main agent's test_generation sub-agent protocol to
the standalone `cli_test_plan_agent` CLI.

InfTest main agent (SubAgentAdapter) invokes sub-agents with:
    --task-id <id> --workspace <dir> --output-json <path>
and expects a SubAgentOutputJson file at --output-json.

`cli_test_plan_agent` instead reads a JSON payload (with a `markdown` field)
from stdin and writes a TestPlan JSON to stdout. This adapter translates
between the two and converts the TestPlan into the canonical
`case_generation/test_cases.json` (root.children[]) shape consumed by
DeviceCoordinateSkill.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import threading
import time
import zipfile
from pathlib import Path
from typing import Any


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def env_str(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def is_real_only_mode() -> bool:
    return env_str("INFTEST_REAL_ONLY").lower() in {"1", "true", "yes", "on"}


def error_tail(*values: str, limit: int = 800) -> str:
    text = "\n".join(value.strip() for value in values if value and value.strip())
    return text[-limit:] if text else ""


def run_subprocess_with_streaming_logs(
    argv: list[str],
    *,
    cwd: str | None,
    stdin_blob: str,
    env: dict[str, str],
    stdout_path: Path,
    stderr_path: Path,
) -> tuple[int, str, str]:
    """Run CLI agent, append stdout/stderr to workspace log files incrementally."""
    stdout_path.write_text("", encoding="utf-8")
    stderr_path.write_text("", encoding="utf-8")

    proc = subprocess.Popen(
        argv,
        cwd=cwd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    assert proc.stdin is not None
    proc.stdin.write(stdin_blob)
    proc.stdin.close()

    stdout_chunks: list[str] = []
    stderr_chunks: list[str] = []

    def pump(
        stream,
        path: Path,
        chunks: list[str],
        label: str,
    ) -> None:
        if stream is None:
            return
        with path.open("a", encoding="utf-8") as log_file:
            for line in iter(stream.readline, ""):
                chunks.append(line)
                log_file.write(line)
                log_file.flush()
                # Forward to adapter stderr so SubAgentAdapter streams to journalctl.
                print(
                    f"[cli_test_plan_agent:{label}] {line.rstrip()}",
                    file=sys.stderr,
                    flush=True,
                )
        stream.close()

    threads = [
        threading.Thread(
            target=pump,
            args=(proc.stdout, stdout_path, stdout_chunks, "stdout"),
            daemon=True,
        ),
        threading.Thread(
            target=pump,
            args=(proc.stderr, stderr_path, stderr_chunks, "stderr"),
            daemon=True,
        ),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return proc.wait(), "".join(stdout_chunks), "".join(stderr_chunks)


def fail_output(
    output_json: Path, task_id: str, started: float, code: str, message: str,
    artifacts: dict[str, str] | None = None,
) -> int:
    write_json(
        output_json,
        {
            "success": False,
            "agent_name": "test_generation",
            "status": "FAILED",
            "task_id": task_id,
            "artifacts": artifacts or {},
            "metrics": {"duration_ms": int((time.time() - started) * 1000)},
            "error": {"code": code, "message": message},
        },
    )
    return 1


def extract_docx_text(path: Path) -> str:
    """Extract plain text from a .docx without external dependencies."""
    with zipfile.ZipFile(path) as archive:
        xml = archive.read("word/document.xml").decode("utf-8", errors="ignore")
    # Treat paragraph and break boundaries as newlines, then strip tags.
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"<w:br[^>]*/>", "\n", xml)
    xml = re.sub(r"<w:tab[^>]*/>", "\t", xml)
    text = re.sub(r"<[^>]+>", "", xml)
    text = (
        text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&apos;", "'")
    )
    lines = [line.rstrip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line.strip())


def read_text_file(path: Path) -> str:
    if path.suffix.lower() == ".docx":
        return extract_docx_text(path)
    return path.read_text(encoding="utf-8", errors="ignore")


def resolve_requirement_markdown(workspace: Path) -> tuple[str, str]:
    """Return (markdown, source_description). Empty markdown means not found."""
    explicit = env_str("INFTEST_CASE_GENERATION_DOC")
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit))
    candidates.extend(
        [
            workspace / "input" / "requirement.md",
            workspace / "input" / "requirement.txt",
            workspace / "input" / "requirement.docx",
        ]
    )
    requirement_doc = env_str("INFTEST_REQUIREMENT_DOC")
    if requirement_doc:
        candidates.append(Path(requirement_doc))

    for candidate in candidates:
        try:
            if candidate.exists() and candidate.is_file():
                text = read_text_file(candidate.resolve())
                if text.strip():
                    return text, str(candidate)
        except Exception:
            continue

    # Last resort: derive a minimal requirement from task_detail.json target.
    task_detail = workspace / "input" / "task_detail.json"
    try:
        if task_detail.exists():
            data = json.loads(task_detail.read_text(encoding="utf-8"))
            target = str(data.get("task_target", "")).strip()
            if target:
                return (
                    f"# 测试需求\n\n{target}\n",
                    f"{task_detail} (task_target fallback)",
                )
    except Exception:
        pass

    return "", ""


def build_payload(markdown: str) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "markdown": markdown,
        "channel": env_str("INFTEST_CASE_AGENT_CHANNEL", "xinhua") or "xinhua",
        "type_type": env_str("INFTEST_CASE_AGENT_TEST_TYPE", "功能") or "功能",
        # inftest=False keeps stdout clean (no extra testcase/ writes required here).
        "inftest": False,
    }

    login_title = env_str("INFTEST_CASE_AGENT_LOGIN_STEP_TITLE")
    if login_title:
        payload["login_step_title"] = login_title

    mcp_url = env_str("INFTEST_CASE_AGENT_MCP_URL")
    if mcp_url:
        payload["mcp_url"] = mcp_url

    llm_api_key = env_str("INFTEST_CASE_AGENT_LLM_API_KEY")
    llm_base_url = env_str("INFTEST_CASE_AGENT_LLM_BASE_URL")
    llm_model = env_str("INFTEST_CASE_AGENT_LLM_MODEL")
    llm_config: dict[str, str] = {}
    if llm_api_key:
        llm_config["api_key"] = llm_api_key
    if llm_base_url:
        llm_config["base_url"] = llm_base_url
    if llm_model:
        llm_config["model"] = llm_model
    if llm_config:
        payload["llm_config"] = llm_config

    case_cfg: dict[str, Any] = {}
    max_depth = env_str("INFTEST_CASE_AGENT_MAX_DEPTH")
    node_budget = env_str("INFTEST_CASE_AGENT_NODE_BUDGET")
    if max_depth.isdigit():
        case_cfg["max_depth"] = int(max_depth)
    if node_budget.isdigit():
        case_cfg["node_budget"] = int(node_budget)
    if case_cfg:
        payload["case_generate_config"] = case_cfg

    return payload


def build_command() -> tuple[list[str], Path | None, dict[str, str]]:
    """Return (argv, cwd, extra_env)."""
    agent_cwd_value = env_str("INFTEST_CASE_AGENT_CWD")
    agent_cwd = Path(agent_cwd_value).resolve() if agent_cwd_value else None

    explicit = env_str("INFTEST_CASE_AGENT_COMMAND")
    extra_env: dict[str, str] = {}
    if explicit:
        return shlex.split(explicit), agent_cwd, extra_env

    python_bin = env_str("INFTEST_CASE_AGENT_PYTHON", "python") or "python"
    module = env_str("INFTEST_CASE_AGENT_MODULE", "cli_test_plan_agent.cli")
    # Module layout lives under <repo>/src, so expose it on PYTHONPATH.
    if agent_cwd is not None:
        src_dir = agent_cwd / "src"
        pythonpath = str(src_dir) if src_dir.exists() else str(agent_cwd)
        existing = os.environ.get("PYTHONPATH", "")
        extra_env["PYTHONPATH"] = (
            f"{pythonpath}{os.pathsep}{existing}" if existing else pythonpath
        )
    return [python_bin, "-m", module], agent_cwd, extra_env


def flatten_suites(suites: list[dict[str, Any]], parent_title: str = "") -> list[dict[str, Any]]:
    children: list[dict[str, Any]] = []
    for suite in suites:
        if not isinstance(suite, dict):
            continue
        suite_title = str(suite.get("title") or parent_title or "未命名模块")
        for case in suite.get("cases", []) or []:
            if not isinstance(case, dict):
                continue
            steps = case.get("steps", []) or []
            case_steps: list[str] = []
            expected: list[str] = []
            for step in steps:
                if not isinstance(step, dict):
                    continue
                action = str(step.get("action", "")).strip()
                exp = str(step.get("expected", "")).strip()
                if action:
                    case_steps.append(action)
                if exp:
                    expected.append(exp)
            preconditions: list[str] = []
            condition = str(case.get("condition", "")).strip()
            data = str(case.get("data", "")).strip()
            if condition:
                preconditions.append(condition)
            if data:
                preconditions.append(data)
            children.append(
                {
                    "node_id": str(case.get("id") or f"case_{len(children) + 1:03d}"),
                    "title": str(case.get("title") or "生成用例"),
                    "type": "CASE",
                    "test_type": "functional",
                    "case_function_point": suite_title,
                    "test_scenario": str(case.get("title") or suite_title),
                    "preconditions": preconditions,
                    "test_steps": case_steps,
                    "expected_result": expected,
                }
            )
        nested = suite.get("suites", []) or []
        if nested:
            children.extend(flatten_suites(nested, suite_title))
    return children


def convert_test_plan(plan: dict[str, Any]) -> dict[str, Any]:
    suites = plan.get("suites", []) or []
    children = flatten_suites(suites)
    return {
        "source": "real_subagent:cli_test_plan_agent",
        "plan_title": str(plan.get("title", "生成测试计划")),
        "plan_version": str(plan.get("version", "1.0")),
        "root": {
            "node_id": "root",
            "title": str(plan.get("title", "生成测试计划")),
            "children": children,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output-json", required=True)
    args = parser.parse_args()

    started = time.time()
    workspace = Path(args.workspace).resolve()
    output_json = Path(args.output_json).resolve()
    case_dir = workspace / "case_generation"
    logs_dir = case_dir / "logs"
    case_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    markdown, source = resolve_requirement_markdown(workspace)
    if not markdown.strip():
        return fail_output(
            output_json,
            args.task_id,
            started,
            "MISSING_REQUIREMENT_DOC",
            "No requirement document found. Set INFTEST_CASE_GENERATION_DOC or "
            "INFTEST_REQUIREMENT_DOC, or provide workspace/input/requirement.md.",
        )

    argv, agent_cwd, extra_env = build_command()
    if agent_cwd is None and not env_str("INFTEST_CASE_AGENT_COMMAND"):
        return fail_output(
            output_json,
            args.task_id,
            started,
            "MISSING_CASE_AGENT_CWD",
            "Set INFTEST_CASE_AGENT_CWD to the cli_test_plan_agent repo directory "
            "(containing config.yaml).",
        )
    if agent_cwd is not None and not agent_cwd.exists():
        return fail_output(
            output_json,
            args.task_id,
            started,
            "CASE_AGENT_CWD_NOT_FOUND",
            f"cli_test_plan_agent directory not found: {agent_cwd}",
        )

    payload = build_payload(markdown)
    stdin_blob = json.dumps(payload, ensure_ascii=False)

    invocation_path = logs_dir / "real_case_generation_invocation.json"
    write_json(
        invocation_path,
        {
            "cwd": str(agent_cwd) if agent_cwd else None,
            "argv": argv,
            "requirement_source": source,
            "channel": payload.get("channel"),
            "type_type": payload.get("type_type"),
            "markdown_chars": len(markdown),
            "extra_env": extra_env,
        },
    )

    run_env = {**os.environ, **extra_env}
    stdout_path = logs_dir / "real_case_generation.stdout.log"
    stderr_path = logs_dir / "real_case_generation.stderr.log"
    cli_logs_hint = f"{agent_cwd}/logs/" if agent_cwd else "n/a"
    print(
        f"[case_generation] streaming logs to {stderr_path} "
        f"(cli internal logs: {cli_logs_hint})",
        file=sys.stderr,
        flush=True,
    )
    try:
        returncode, proc_stdout, proc_stderr = run_subprocess_with_streaming_logs(
            argv,
            cwd=str(agent_cwd) if agent_cwd else None,
            stdin_blob=stdin_blob,
            env=run_env,
            stdout_path=stdout_path,
            stderr_path=stderr_path,
        )
        proc = subprocess.CompletedProcess(argv, returncode, proc_stdout, proc_stderr)
    except FileNotFoundError as error:
        return fail_output(
            output_json,
            args.task_id,
            started,
            "CASE_AGENT_NOT_EXECUTABLE",
            f"Failed to launch case generation agent: {error}",
            {"invocation": str(invocation_path)},
        )

    base_artifacts = {
        "stdout_log": str(stdout_path),
        "stderr_log": str(stderr_path),
        "invocation": str(invocation_path),
    }

    if proc.returncode != 0:
        detail = error_tail(proc.stderr, proc.stdout)
        message = f"Case generation agent exited with code {proc.returncode}."
        if detail:
            message = f"{message} {detail}"
        return fail_output(
            output_json, args.task_id, started, "CASE_AGENT_FAILED", message, base_artifacts
        )

    # cli_test_plan_agent prints the TestPlan JSON as the last stdout object.
    raw = proc.stdout.strip()
    plan: dict[str, Any] | None = None
    try:
        plan = json.loads(raw)
    except json.JSONDecodeError:
        for line in reversed(raw.splitlines()):
            line = line.strip()
            if line.startswith("{") and line.endswith("}"):
                try:
                    plan = json.loads(line)
                    break
                except json.JSONDecodeError:
                    continue

    if not isinstance(plan, dict) or "suites" not in plan:
        return fail_output(
            output_json,
            args.task_id,
            started,
            "CASE_AGENT_OUTPUT_INVALID",
            "Case generation agent stdout was not a valid TestPlan JSON.",
            base_artifacts,
        )

    raw_plan_path = case_dir / "cli_test_plan_raw.json"
    write_json(raw_plan_path, plan)

    converted = convert_test_plan(plan)
    children = converted["root"]["children"]
    if not children:
        return fail_output(
            output_json,
            args.task_id,
            started,
            "CASE_AGENT_NO_CASES",
            "Case generation agent produced a plan with zero cases.",
            {**base_artifacts, "cli_test_plan_raw": str(raw_plan_path)},
        )

    test_cases_path = case_dir / "cli_test_cases.json"
    write_json(test_cases_path, converted)

    write_json(
        output_json,
        {
            "success": True,
            "agent_name": "test_generation",
            "status": "SUCCESS",
            "task_id": args.task_id,
            "artifacts": {
                "test_cases": str(test_cases_path),
                "cli_test_plan_raw": str(raw_plan_path),
                **base_artifacts,
            },
            "metrics": {
                "duration_ms": int((time.time() - started) * 1000),
                "case_count": len(children),
            },
            "error": None,
        },
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
