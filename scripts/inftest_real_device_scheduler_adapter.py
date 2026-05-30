#!/usr/bin/env python3
"""Wrap ``device_agent`` (discover + bind) and emit InfTest sub-agent artifacts."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def env_bool(name: str, default: str = "false") -> bool:
    value = os.environ.get(name, default).strip().lower()
    return value in {"1", "true", "yes", "on"}


def is_real_only_mode() -> bool:
    return env_bool("INFTEST_REAL_ONLY")


def default_device_agent_cwd() -> Path | None:
    explicit = os.environ.get("INFTEST_DEVICE_AGENT_CWD", "").strip()
    if explicit:
        return Path(explicit).resolve()
    sibling = REPO_ROOT.parent / "inftest_execute_agent"
    if (sibling / "device_agent").is_dir():
        return sibling.resolve()
    return None


def load_plan_config(workspace: Path) -> dict[str, Any]:
    path = workspace / "input" / "plan_config.json"
    if not path.is_file():
        return {}
    try:
        data = read_json(path)
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def load_executable_cases(workspace: Path) -> list[dict[str, Any]]:
    test_cases_path = workspace / "case_generation" / "test_cases.json"
    if not test_cases_path.is_file():
        return []

    try:
        payload = read_json(test_cases_path)
    except (json.JSONDecodeError, OSError):
        return []

    if not isinstance(payload, dict):
        return []

    legacy = payload.get("cases")
    if isinstance(legacy, list) and legacy:
        cases: list[dict[str, Any]] = []
        for item in legacy:
            if isinstance(item, dict):
                cases.append(normalize_manual_case(item))
        return cases

    root = payload.get("root")
    if not isinstance(root, dict):
        return []
    children = root.get("children")
    if not isinstance(children, list):
        return []

    cases = []
    for child in children:
        if not isinstance(child, dict):
            continue
        case_id = child.get("node_id") or child.get("case_name") or child.get("title")
        if not case_id:
            continue
        cases.append(
            normalize_manual_case(
                {
                    "case_id": str(case_id),
                    "case_name": child.get("case_name") or child.get("title") or case_id,
                    "case_step": child.get("case_step") or child.get("test_steps"),
                    "expected_result": child.get("expected_result"),
                    "case_function_point": child.get("case_function_point"),
                    "test_scenario": child.get("test_scenario") or child.get("title"),
                }
            )
        )
    return cases


def to_string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def parse_doc_steps(steps: Any) -> tuple[list[str], list[str]]:
  if not isinstance(steps, list):
    return [], []
  case_step: list[str] = []
  expected_result: list[str] = []
  for item in steps:
    if isinstance(item, str) and item.strip():
      case_step.append(item.strip())
      continue
    if not isinstance(item, dict):
      continue
    action = str(item.get("action") or item.get("step") or item.get("description") or "").strip()
    expected = str(item.get("expected") or item.get("expected_result") or "").strip()
    if action:
      case_step.append(action)
    if expected:
      expected_result.append(expected)
  return case_step, expected_result


def normalize_manual_case(raw: dict[str, Any]) -> dict[str, Any]:
    case_id = str(raw.get("case_id") or "case-unknown")
    case_name = str(raw.get("case_name") or raw.get("title") or case_id)
    from_steps, from_expected = parse_doc_steps(raw.get("steps"))
    case_step = to_string_list(raw.get("case_step") or raw.get("test_steps"))
    if not case_step and from_steps:
        case_step = from_steps
    expected_result = to_string_list(raw.get("expected_result"))
    if not expected_result and from_expected:
        expected_result = from_expected
    return {
        "case_id": case_id,
        "case_name": case_name,
        "case_step": case_step,
        "expected_result": expected_result,
        "case_function_point": str(
            raw.get("case_function_point") or raw.get("type") or "自动生成功能点"
        ),
        "test_scenario": str(raw.get("test_scenario") or case_name),
    }


def max_parallel_devices(workspace: Path, cli_override: int | None = None) -> int:
    if cli_override is not None and cli_override > 0:
        return cli_override
    plan = load_plan_config(workspace)
    info = plan.get("device_schedule_info")
    if isinstance(info, dict):
        value = info.get("max_schedule_device_num")
        if isinstance(value, int) and value > 0:
            return value
    env_value = os.environ.get("INFTEST_MAX_SCHEDULE_DEVICE_NUM", "").strip()
    if env_value.isdigit() and int(env_value) > 0:
        return int(env_value)
    return 8


def resolve_devices_arg(workspace: Path) -> str | None:
    devices_env = os.environ.get("INFTEST_DEVICE_AGENT_DEVICES", "").strip()
    if devices_env:
        return devices_env

    device_id = os.environ.get("INFTEST_DEVICE_ID", "").strip()
    if device_id:
        payload = [
            {
                "device_id": device_id,
                "device_name": device_id,
                "device_type": os.environ.get("INFTEST_DEVICE_TYPE", "adb"),
            }
        ]
        devices_file = workspace / "device_scheduling" / "devices_input.json"
        write_json(devices_file, payload)
        return f"@{devices_file}"

    devices_file = workspace / "input" / "devices.json"
    if devices_file.is_file():
        return f"@{devices_file}"
    return None


def build_device_agent_argv(
    *,
    agent_cwd: Path,
    python_bin: str,
    subcommand: str,
    extra: list[str],
) -> list[str]:
    # Always invoke as a package module; running main.py directly breaks relative imports.
    _ = agent_cwd
    return [python_bin, "-m", "device_agent", subcommand, *extra]


def run_device_agent(
    *,
    agent_cwd: Path,
    python_bin: str,
    subcommand: str,
    extra: list[str],
) -> tuple[int, str, str, dict[str, Any] | None]:
    argv = build_device_agent_argv(
        agent_cwd=agent_cwd,
        python_bin=python_bin,
        subcommand=subcommand,
        extra=extra,
    )
    env = os.environ.copy()
    env.setdefault("PYTHONPATH", str(agent_cwd))
    if env.get("PYTHONPATH"):
        env["PYTHONPATH"] = f"{agent_cwd}{os.pathsep}{env['PYTHONPATH']}"

    proc = subprocess.run(
        argv,
        cwd=str(agent_cwd),
        env=env,
        capture_output=True,
        text=True,
        timeout=int(os.environ.get("INFTEST_DEVICE_AGENT_TIMEOUT_SEC", "300")),
    )
    parsed: dict[str, Any] | None = None
    stdout = (proc.stdout or "").strip()
    if stdout:
        try:
            parsed = json.loads(stdout)
        except json.JSONDecodeError:
            # device_agent may print multi-line JSON; take last object line
            for line in reversed(stdout.splitlines()):
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    parsed = json.loads(line)
                    break
                except json.JSONDecodeError:
                    continue
    return proc.returncode, stdout, proc.stderr or "", parsed


def discover_devices(agent_cwd: Path, python_bin: str, max_parallel: int) -> list[dict[str, Any]]:
    extra: list[str] = ["--max-parallel", str(max_parallel)]
    if env_bool("INFTEST_DEVICE_AGENT_CLOUD"):
        extra.append("--cloud")
        agent_url = os.environ.get("CMD_EXECUTOR_AGENT_URL", "").strip()
        if agent_url:
            extra.extend(["--agent-url", agent_url])
    else:
        device_type = os.environ.get("INFTEST_DEVICE_TYPE", "").strip()
        if device_type:
            extra.extend(["--device-type", device_type])

    code, stdout, stderr, payload = run_device_agent(
        agent_cwd=agent_cwd,
        python_bin=python_bin,
        subcommand="discover",
        extra=extra,
    )
    if code != 0 or not isinstance(payload, dict) or not payload.get("success"):
        message = ""
        if isinstance(payload, dict):
            message = str(payload.get("error") or "")
        if not message:
            message = stderr.strip() or stdout.strip() or "device discover failed"
        raise RuntimeError(message)

    devices = payload.get("devices")
    if not isinstance(devices, list) or not devices:
        raise RuntimeError("device discover returned no devices")
    return [item for item in devices if isinstance(item, dict)]


def bind_devices(
    *,
    agent_cwd: Path,
    python_bin: str,
    task_id: str,
    case_count: int,
    devices: list[dict[str, Any]] | None,
    devices_arg: str | None,
) -> dict[str, Any]:
    extra = ["--task-id", task_id, "--case-count", str(case_count)]
    if devices_arg:
        extra.extend(["--devices", devices_arg])
    elif devices:
        devices_file = agent_cwd / ".inftest_device_scheduler_devices.json"
        write_json(devices_file, devices)
        extra.extend(["--devices", f"@{devices_file}"])

    code, stdout, stderr, payload = run_device_agent(
        agent_cwd=agent_cwd,
        python_bin=python_bin,
        subcommand="bind",
        extra=extra,
    )
    if code != 0 or not isinstance(payload, dict) or not payload.get("success"):
        message = ""
        if isinstance(payload, dict):
            message = str(payload.get("error") or "")
        if not message:
            message = stderr.strip() or stdout.strip() or "device bind failed"
        raise RuntimeError(message)

    bind = payload.get("device_task_bind")
    if not isinstance(bind, dict):
        raise RuntimeError("device bind response missing device_task_bind")
    return bind


def build_device_bindings(task_id: str, bind: dict[str, Any], cases: list[dict[str, Any]]) -> dict[str, Any]:
    case_bindings = bind.get("case_bindings")
    if not isinstance(case_bindings, list):
        case_bindings = []

    bindings: list[dict[str, Any]] = []
    for index, binding in enumerate(case_bindings):
        if not isinstance(binding, dict):
            continue
        case_index = int(binding.get("case_index") or index + 1)
        manual = cases[case_index - 1] if 0 < case_index <= len(cases) else {}
        case_id = str(manual.get("case_id") or f"case_{case_index:03d}")
        bindings.append(
            {
                "case_id": case_id,
                "case_index": case_index,
                "device_id": binding.get("device_id"),
                "device_name": binding.get("device_name"),
                "platform": binding.get("device_type") or "android",
                "status": "BOUND",
            }
        )

    if not bindings and cases:
        devices = bind.get("devices")
        device_list = devices if isinstance(devices, list) else []
        for index, manual in enumerate(cases, 1):
            dev = device_list[(index - 1) % len(device_list)] if device_list else {}
            bindings.append(
                {
                    "case_id": manual["case_id"],
                    "case_index": index,
                    "device_id": dev.get("device_id") if isinstance(dev, dict) else None,
                    "device_name": dev.get("device_name") if isinstance(dev, dict) else None,
                    "platform": (dev.get("device_type") if isinstance(dev, dict) else None) or "android",
                    "status": "BOUND",
                }
            )

    return {"task_id": task_id, "bindings": bindings, "device_task_bind": bind}


def build_device_case_bind(cases: list[dict[str, Any]], bindings: list[dict[str, Any]]) -> dict[str, Any]:
    device_case: dict[str, Any] = {}
    binding_by_index = {
        int(item.get("case_index") or 0): item for item in bindings if isinstance(item, dict)
    }
    for index, manual in enumerate(cases, 1):
        binding = binding_by_index.get(index) or {}
        device_id = str(binding.get("device_id") or os.environ.get("INFTEST_DEVICE_ID", "unknown-device"))
        key = device_id if len(cases) == 1 else f"{device_id}::{manual['case_id']}"
        device_case[key] = {
            "case_id": manual["case_id"],
            "case_name": manual["case_name"],
            "case_step": manual.get("case_step") or [],
            "case_function_point": manual.get("case_function_point"),
            "test_scenario": manual.get("test_scenario"),
            "expected_result": manual.get("expected_result") or [],
            "device_id": device_id,
            "device_name": binding.get("device_name"),
            "device_type": binding.get("platform"),
        }
    return {"device_case": device_case}


def fail_output(
    *,
    output_json: Path,
    task_id: str,
    code: str,
    message: str,
    duration_ms: int,
) -> int:
    write_json(
        output_json,
        {
            "success": False,
            "agent_name": "device_scheduler",
            "status": "FAILED",
            "task_id": task_id,
            "artifacts": {},
            "metrics": {"duration_ms": duration_ms},
            "error": {"code": code, "message": message},
        },
    )
    return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--max-schedule-device-num", type=int, default=None)
    args = parser.parse_args()

    started = time.time()
    workspace = Path(args.workspace).resolve()
    output_json = Path(args.output_json).resolve()
    scheduling_dir = workspace / "device_scheduling"
    scheduling_dir.mkdir(parents=True, exist_ok=True)

    agent_cwd = default_device_agent_cwd()
    if agent_cwd is None:
        return fail_output(
            output_json=output_json,
            task_id=args.task_id,
            code="DEVICE_AGENT_CWD_MISSING",
            message=(
                "Set INFTEST_DEVICE_AGENT_CWD to inftest_execute_agent repo, "
                "or place inftest_execute_agent next to InfTest-Main-Agent."
            ),
            duration_ms=int((time.time() - started) * 1000),
        )

    python_bin = os.environ.get("INFTEST_DEVICE_AGENT_PYTHON", "python3")
    cases = load_executable_cases(workspace)
    if not cases:
        return fail_output(
            output_json=output_json,
            task_id=args.task_id,
            code="MISSING_TEST_CASES",
            message="No executable cases found in case_generation/test_cases.json",
            duration_ms=int((time.time() - started) * 1000),
        )

    max_parallel = max_parallel_devices(workspace, args.max_schedule_device_num)
    devices_arg = resolve_devices_arg(workspace)
    discovered: list[dict[str, Any]] | None = None

    try:
        if not devices_arg and env_bool("INFTEST_DEVICE_AGENT_DISCOVER", "true"):
            discovered = discover_devices(agent_cwd, python_bin, max_parallel)
            if discovered:
                discovered = discovered[:max_parallel]

        bind = bind_devices(
            agent_cwd=agent_cwd,
            python_bin=python_bin,
            task_id=args.task_id,
            case_count=len(cases),
            devices=discovered,
            devices_arg=devices_arg,
        )
    except Exception as error:
        return fail_output(
            output_json=output_json,
            task_id=args.task_id,
            code="DEVICE_SCHEDULING_FAILED",
            message=str(error),
            duration_ms=int((time.time() - started) * 1000),
        )

    bindings_payload = build_device_bindings(args.task_id, bind, cases)
    bindings_path = scheduling_dir / "device_bindings.json"
    case_bind_path = scheduling_dir / "device_case_bind.json"
    schedule_info_path = scheduling_dir / "schedule_info.json"

    write_json(bindings_path, bindings_payload)
    write_json(
        case_bind_path,
        build_device_case_bind(cases, bindings_payload.get("bindings") or []),
    )
    write_json(
        schedule_info_path,
        {
            "source": "real_device_agent",
            "task_id": args.task_id,
            "device_task_bind": bind,
            "discovered_devices": discovered,
            "case_count": len(cases),
        },
    )

    duration_ms = int((time.time() - started) * 1000)
    write_json(
        output_json,
        {
            "success": True,
            "agent_name": "device_scheduler",
            "status": "SUCCESS",
            "task_id": args.task_id,
            "artifacts": {
                "device_bindings": str(bindings_path),
                "device_case_bind": str(case_bind_path),
                "device_scheduling_info": str(schedule_info_path),
            },
            "metrics": {"duration_ms": duration_ms, "case_count": len(cases)},
            "error": None,
        },
    )
    print(f"device scheduling complete: {bindings_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
