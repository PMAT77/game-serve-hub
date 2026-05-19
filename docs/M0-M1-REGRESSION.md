# M0/M1 回归验收剧本

> 用途：M0 全链路回归与 M1 监控台验收的手工检查清单。  
> 不替代 `docs/11-ACCEPTANCE-TEST-STANDARD.md`，与之配套使用。

## 前置

- 已安装依赖，前后端可启动
- 测试账号可登录
- 可选：分别验证 Docker 运行 / 停止两种环境

## 用例

| # | 场景 | 操作步骤 | 期望结果 |
|---|------|----------|----------|
| 1 | 正常全链路 | 创建实例 → 等待安装完成 → 启动 → 控制台发送命令 → 停止 → 删除 | 全流程成功，状态与日志一致 |
| 2 | Docker 停止负向 | 停止 Docker 后分别调用 create / start / update | 返回统一「容器运行时未就绪」类错误，响应含 `requestId` |
| 3 | 安装中删除 | 创建实例后立即删除（安装进行中） | 安装任务被取消，无孤儿 SteamCMD 容器，DB 记录已删除 |
| 4 | DB/容器漂移 | 容器仍在运行但 DB 为 stopped 时点击启动 | 幂等成功，DB 同步为 running |
| 5 | 监控页异常 | 断网或模拟后端 500，打开监控台 | 显示错误提示与重试按钮；网络失败时保留曲线并提示可能过期 |
| 6 | 健康检查 | `GET /health` | 响应 JSON 含 `docker: running \| stopped` |
| 7 | 运行时元信息 | `GET /api/meta/runtime` | 含 `runtimeMode`、`dockerStatus`、`steamcmdImageReady` |
| 8 | 监控轮询配置 | 监控页修改轮询间隔 | 刷新后间隔仍生效（localStorage） |

## 自动化

```bash
pnpm test:server
```

应包含：

- `ensureContainerRuntimeReady` Docker/镜像门禁
- `fetchRemoteBuildId` Docker 停止时不调用容器 SteamCMD
- `instanceConsoleLogStore.removeInstance` 清理行为

---

## M0 验收记录

| 日期 | 结论 | 确认人 | 说明 |
|------|------|--------|------|
| 2026-05-19 | **M0 已完成** | 产品方 | 面板安装 → SteamCMD → 实例创建 → 游戏安装 → DST 容器启动全链路跑通；DST 镜像已发布且含 `libcurl3-gnutls` |

## M0 回归终局状态（2026-05-19）

| # | M0 结论 | 验证方式 |
|---|---------|----------|
| 1 | **通过** | 产品方终验：创建 → 安装 → 启动（稳态 CPU ~10%）→ 控制台 → 停止 |
| 2 | **通过** | 宿主机 Docker 停 + `pnpm dev:server` @9527 + `m0-m1-regression-supplement.ts` |
| 3 | **通过** | 安装中删除，DB 清除（Agent 跑批 + 逻辑未回归） |
| 4 | **通过** | 实例 `902623f7-…`：DB 置 stopped 后 `start` 幂等（`dev:compose`） |
| 5 | **通过** | API + 浏览器 Offline/重试点验 |
| 6 | **通过** | `GET /health` |
| 7 | **通过** | `GET /api/meta/runtime` |
| 8 | **通过** | 代码审查 + 浏览器轮询间隔 localStorage 点验 |

**自动化**：`pnpm test:server` → **35/35**。

**脚本**：

| 脚本 | 用途 |
|------|------|
| `server/scripts/m0-m1-regression.ts` | 用例 1–8 批量（默认 `http://127.0.0.1:9527`，账号见 `server/.env.development`） |
| `server/scripts/m0-m1-regression-supplement.ts` | 用例 2 / 4 / 5 / 8 补测（Docker 停/开分环境） |

**DST 运行镜像**：`GSH_GAME_DST_IMAGE` 须含 `libcurl3-gnutls`（`docker/game-dst/Dockerfile`）；GHCR `latest` 已重新发布。

### 补测命令速查

**dev:compose**（端口 3000，`admin` / `admin`）：

```bash
docker exec \
  -e REGRESSION_BASE_URL=http://127.0.0.1:3000 \
  -e REGRESSION_ACCOUNT=admin \
  -e REGRESSION_PASSWORD=admin \
  -e REGRESSION_INSTANCE_ID=<running-instance-uuid> \
  -e REGRESSION_DB_PATH=/app/data/game-server-hub.sqlite \
  game-server-hub-panel \
  sh -c "cd /app && pnpm exec tsx server/scripts/m0-m1-regression-supplement.ts"
```

**宿主机 dev:server**（端口 **9527**，`superman` / `123456`，Docker 停，用例 2）：

```powershell
# 终端 1：pnpm dev:server
# 终端 2：
$env:REGRESSION_BASE_URL="http://127.0.0.1:9527"
$env:REGRESSION_ACCOUNT="superman"
$env:REGRESSION_PASSWORD="123456"
pnpm exec tsx server/scripts/m0-m1-regression-supplement.ts
```

**监控台 UI 点验**（`http://localhost:9000/console/monitor`）：Offline → 错误 + 重试 → 恢复；改轮询间隔后刷新仍保留。

---

## 记录模板

| 日期 | 版本/分支 | 执行人 | 用例 1-8 | 备注 |
|------|-----------|--------|----------|------|
| 2026-05-19 | M0 完成 | 产品方 + Agent | **全部通过** | 见 §M0 回归终局状态；`pnpm test:server` 35/35 |

<details>
<summary>历史：2026-05-19 首次 Agent 跑批（已由终局状态取代）</summary>

| # | 结果 | 说明 |
|---|------|------|
| 1 | 阻塞（环境） | DST 镜像缺库；后经 `libcurl3-gnutls` 与 GHCR 发版修复 |
| 2 | 跳过 | 未停 Docker |
| 3 | 通过 | 安装中删除 |
| 4 | 阻塞（环境） | 无 running 容器 |
| 5 | 部分通过 | 仅 API |
| 6–7 | 通过 | |
| 8 | 部分通过 | 仅代码 |

</details>

---

## M1 待办（非 M0 阻塞）

- 监控台容器摘要、规划态模块 03/04/07 等见 `docs/TODO.md` §3.2
