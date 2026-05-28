#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


REPORT_MARKDOWN = """# 整合测试报告

## 一、总体结果

本次联调使用执行 Agent mock 产物，结构化日志显示 1 条用例执行通过，未发现失败用例。

## 二、用例概览

| 指标 | 数值 |
| --- | ---: |
| 总用例数 | 1 |
| 通过用例数 | 1 |
| 失败用例数 | 0 |
| 通过率 | 100% |

## 三、结论

HTTP API、InfTest 主 Agent、执行结果产物、真实报告 Agent CLI 调用链路已完成本地闭环验证。当前报告内容由本地 OpenAI 兼容 stub 生成，仅用于无真实模型服务时的联调。
"""


class MockOpenAIHandler(BaseHTTPRequestHandler):
    server_version = "InfTestMockOpenAI/1.0"

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/v1/models":
            self._send_json(
                200,
                {
                    "object": "list",
                    "data": [
                        {
                            "id": "inftest-mock-model",
                            "object": "model",
                            "created": int(time.time()),
                            "owned_by": "inftest",
                        }
                    ],
                },
            )
            return
        self._send_json(404, {"error": {"message": f"Unknown path: {self.path}"}})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/v1/chat/completions":
            self._send_json(404, {"error": {"message": f"Unknown path: {self.path}"}})
            return

        raw_length = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_length)
        except ValueError:
            length = 0

        request: dict[str, Any] = {}
        if length > 0:
            try:
                request = json.loads(self.rfile.read(length).decode("utf-8"))
            except json.JSONDecodeError:
                request = {}

        model = str(request.get("model") or "inftest-mock-model")
        self._send_json(
            200,
            {
                "id": f"chatcmpl-inftest-mock-{int(time.time())}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": REPORT_MARKDOWN,
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 1,
                    "completion_tokens": len(REPORT_MARKDOWN),
                    "total_tokens": len(REPORT_MARKDOWN) + 1,
                },
            },
        )

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), MockOpenAIHandler)
    print(f"InfTest mock OpenAI server listening on http://{args.host}:{args.port}/v1", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
