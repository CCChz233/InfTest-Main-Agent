# InfTest Main Agent 服务启动重启说明

## 当前服务信息

- 服务名：`inftest-main-agent`
- 监听地址：`0.0.0.0:8787`
- 本机健康检查：`http://127.0.0.1:8787/health`
- 内网联调地址：`http://172.31.1.79:8787`

## 关键文件

```bash
/etc/systemd/system/inftest-main-agent.service
/etc/inftest-main-agent/config.json
/etc/inftest-main-agent/env
```

systemd 实际启动命令：

```bash
cd /root/InfTest-Main-Agent
/root/.bun/bin/bun run scripts/inftest_task_api.ts
```

## 常用操作

重启服务：

```bash
systemctl restart inftest-main-agent
```

启动服务：

```bash
systemctl start inftest-main-agent
```

停止服务：

```bash
systemctl stop inftest-main-agent
```

查看状态：

```bash
systemctl status inftest-main-agent --no-pager -l
```

查看实时日志：

```bash
journalctl -u inftest-main-agent -f
```

确认开机自启：

```bash
systemctl is-enabled inftest-main-agent
```

设置开机自启：

```bash
systemctl enable inftest-main-agent
```

## 健康检查

本机检查：

```bash
curl http://127.0.0.1:8787/health
```

内网检查：

```bash
curl http://172.31.1.79:8787/health
```

预期返回：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "status": "ok"
  }
}
```

## 手动启动方式

如果需要绕开 systemd 手动启动，先停止 systemd 服务，避免端口冲突：

```bash
systemctl stop inftest-main-agent
```

然后执行：

```bash
cd /root/InfTest-Main-Agent
set -a
source /etc/inftest-main-agent/env
set +a

/root/.bun/bin/bun run scripts/inftest_task_api.ts
```

看到下面输出表示服务已启动：

```text
InfTest task API listening on http://0.0.0.0:8787
```

恢复 systemd 管理：

```bash
systemctl start inftest-main-agent
```

## 联调接口

健康检查：

```bash
curl http://172.31.1.79:8787/health
```

启动任务：

```bash
curl -sS -X POST http://172.31.1.79:8787/tasks/alter \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-joint-001","task_operation":"START"}'
```

查询任务：

```bash
curl -sS http://172.31.1.79:8787/tasks/task-joint-001
```

终止任务：

```bash
curl -sS -X POST http://172.31.1.79:8787/tasks/terminate \
  -H "Content-Type: application/json" \
  -d '{"task_id":"task-joint-001"}'
```

注意：

- `POST /tasks/alter START`：同步接口，会等待真实执行 Agent 跑完才返回。
- `/api/*` 已是 real 入口（以异步受理为主），平台联调优先走 `/api/*`。
- `POST /api/task-manage START`：异步接口，立即 ACK（`task_status=PENDING`），结果通过 `GET /tasks/{exec_id}` 查询。
- 如果只是确认服务通不通，先调用 `/health`。

## Proxy 联调注意

如果同事通过 `inftest_proxy` 访问，需要确认 proxy 启动时加载了：

```bash
/root/inftest_proxy/configs/proxy.env
```

其中下游主 Agent 地址应为：

```bash
PROXY_DOWNSTREAM_AGENT_HTTP_BASE_URL=http://172.31.1.79:8787
```

如果 proxy 没加载该配置，可能会转发到默认下游 `127.0.0.1:8080`，并出现类似：

```text
downstream agent HTTP 503: JWT 鉴权依赖的数据库未启用
```
