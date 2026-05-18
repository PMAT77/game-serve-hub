# GameServerHub 运维手册（Runbook）

> 安装、日志、故障排查。面向自托管管理员。  
> 最后更新：2026-05-18

## 1. 默认路径（Linux 安装脚本）

| 项 | 默认路径 |
|----|---------|
| 安装目录 | `/opt/game-server-hub` |
| 数据目录 | `/var/lib/game-server-hub` |
| 日志目录 | `/var/log/game-server-hub` |
| Compose 文件 | `/opt/game-server-hub/docker-compose.yml` |
| 环境文件 | `/opt/game-server-hub/panel.env` |
| 安装状态 | `/var/log/game-server-hub/install.status` |
| SQLite（开发） | `server/data/game-server-hub.sqlite` |

M0 后实例游戏文件建议在 `/var/lib/game-server-hub/instances/<instanceId>/`。

## 2. 常用命令

```bash
# 查看栈状态
docker compose -f /opt/game-server-hub/docker-compose.yml ps

# 面板日志
docker logs -f game-server-hub-panel

# 重启面板
docker compose -f /opt/game-server-hub/docker-compose.yml restart panel

# 开发模式 — 宿主机（快速迭代）
pnpm run dev:prepare && pnpm run dev

# 开发模式 — Compose（推荐，与生产同栈）
pnpm run dev:compose
# 停止：pnpm run dev:compose:down
```

按实例查看游戏容器：

```bash
docker logs -f game-<instanceId>-master
```

## 3. 健康检查

| 检查 | 命令/URL |
|------|---------|
| 面板探活 | `curl -s http://127.0.0.1:${PANEL_PORT}/health` |
| API | 登录后访问 `/app/system/info` |

## 4. 常见问题

### 4.1 无法访问面板

1. `docker ps` 确认 panel 容器 running。  
2. 检查防火墙是否放行 `PANEL_PORT`（安装脚本尝试配置 ufw/firewalld）。  
3. 检查端口占用：`ss -lntp | grep $PANEL_PORT`。

### 4.2 安装脚本失败

1. 阅读 `/var/log/game-server-hub/install.status` 最后几条。  
2. 确认磁盘 ≥ 4GB、可访问 `ghcr.io` 与 `download.docker.com`。  
3. 失败时脚本可能已执行 `docker compose down` 回滚。

### 4.3 实例一直 installing / error

1. 面板 UI 查看安装日志；或 `GET /app/instance/install-log?instanceId=`。  
2. 检查 SteamCMD 配置与磁盘空间。  
3. 查看 `last_error` 字段（实例列表 API）。

### 4.4 显示 running 但无法进服

1. 实例控制台看 DST 日志。  
2. 核对 `server.ini` 中 `server_port` 与防火墙映射。  
3. `docker inspect game-<instanceId>-master` 查看容器状态与端口绑定。  
4. 参考 [DST-OPS.md](DST-OPS.md) 离线房/密码设置。

### 4.5 强制改密循环

- 确认 `panel.env` 中 `FORCE_PASSWORD_CHANGE`；改密成功后应写回 0 或清除（以实现为准）。

### 4.6 控制台无日志 / 命令无效

- 仅 `running` 且对应游戏容器存活时有效；部分日志能力仍过渡态（见 [FDS-09](FDS/09-console.md)）。  
- 确认访问的是 **实例控制台**，非主机监控台。

## 5. 备份与恢复（运维侧）

- 面板备份文件目录见 [FDS-06](FDS/06-backup.md)（规划 `gsh-backups` 卷）。  
- 手工紧急备份：停止实例后打包 Cluster 目录（见 DOMAIN）。

## 6. 升级面板

```bash
docker compose --env-file /opt/game-server-hub/panel.env \
  -f /opt/game-server-hub/docker-compose.yml \
  -f /opt/game-server-hub/docker-compose.bind.yml \
  pull panel
docker compose --env-file /opt/game-server-hub/panel.env \
  -f /opt/game-server-hub/docker-compose.yml \
  -f /opt/game-server-hub/docker-compose.bind.yml \
  up -d panel
```

升级前建议备份 `PANEL_DATA_DIR` 与 SQLite。

## 7. 安全建议

- 首次登录立即改密；勿暴露安装脚本输出的密码。  
- 面板不要直接暴露公网而无反向代理/TLS（生产建议 Nginx + HTTPS）。  
- 限制 Docker socket 挂载范围；仅管理员可访问面板。  
- 定期应用系统安全更新。

## 8. 相关文档

- [ACCEPTANCE.md](ACCEPTANCE.md) — 验收步骤  
- [ARCHITECTURE.md](ARCHITECTURE.md) — 拓扑  
- [FDS-00-install-runtime.md](FDS/00-install-runtime.md) — 安装设计  

---

*生产事故可在此追加条目并注明日期。*
