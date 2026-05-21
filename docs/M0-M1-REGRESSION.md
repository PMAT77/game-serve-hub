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
| `server/scripts/m1-shard-regression.ts` | M1 模块 04 Shard S1–S7（默认 `http://127.0.0.1:3000`） |

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

## M1 Shard（模块 04）建议回归

> 标准见 `docs/FDS/04-dst-shard.md` §9；自动化见 `pnpm test:server`（含 cluster/shard 相关用例）。

| # | 场景 | 操作步骤 | 期望结果 |
|---|------|----------|----------|
| S1 | 仅主世界 | 房间未开分片 → 启动实例 | 仅 `gsh-{id}-master` 容器运行 |
| S2 | 开分片自动 scaffold | 房间设置开启「启用分片」并保存（此前无 `Caves/`） | 保存成功；磁盘出现 `Caves/server.ini` 与 `worldgenoverride.lua` |
| S3 | 世界设置编辑洞穴 | 世界设置 → 修改洞穴 worldgen/端口 → 保存 | 文件更新；与主世界端口不冲突 |
| S4 | 双容器启动 | 分片已开 → 启动实例 | `gsh-{id}-master` 与 `gsh-{id}-caves` 均运行 |
| S5 | 关闭分片保留文件 | 房间关闭分片并保存 → 再启动 | `Caves/` 仍在；仅 Master 容器启动 |
| S6 | 停止顺序 | 运行中停止实例 | 洞穴容器先于主世界停止（inspect/日志） |
| S7 | 未开分片不可编辑洞穴 | 世界设置页 | 洞穴区提示前往房间设置，无保存洞穴表单 |

### M1 Shard 验收记录

| 日期 | 主测实例 | 执行人 | S1–S7 | FDS §9 进洞 | 备注 |
|------|----------|--------|-------|-------------|------|
| 2026-05-21 | `902623f7-…`（饥荒联机）；S2 首次 scaffold 另验 `reg-m1-shard` `2335e9c4-…` | Agent + 产品方 | **全部通过** | **PASS**（产品方已验） | `pnpm test:server` 118/118；脚本 `server/scripts/m1-shard-regression.ts` |

| # | 结果 | 验证方式 |
|---|------|----------|
| S1 | **通过** | API 启停 + `docker ps`：仅 master Up |
| S2 | **通过** | `reg-m1-shard` 首次保存生成 `Caves/`；`902623f7` 幂等不覆盖 |
| S3 | **通过** | PUT shards 更新端口；冲突端口返回 `COMMON_BUSINESS_RULE_VIOLATION` |
| S4 | **通过** | master + caves 均为 running |
| S5 | **通过** | 关分片后 `Caves/` 仍在，仅 master 启动 |
| S6 | **通过** | 停止轮询 + `FinishedAt`：caves 先于 master |
| S7 | **通过** | 未开分片时 PUT caves 被拒绝 |

**脚本**（dev:compose，`admin`/`admin`，端口 3000）：

```powershell
$env:REGRESSION_BASE_URL="http://127.0.0.1:3000"
$env:REGRESSION_INSTANCE_ID="902623f7-9e75-4800-88b3-04608e2c5f56"
pnpm exec tsx server/scripts/m1-shard-regression.ts
```

可选：新建 `reg-m1-shard` 覆盖 S2 首次 scaffold；`2335e9c4-…` 经 install seed 修复后已含完整 `data/`，可正常启动容器。

### 安装完整性修复（2026-05-21）

此前 `reg-m1-shard` 经 SteamCMD 安装后缺少 `data/`（install seed 仅复制 `bin/`/`steamapps/`，就绪检测也未校验 `data/`），导致 DST 容器 `Could not load scripts/main.lua`。**已修复**：

- `depot-copy`：复制供体安装根下除 `klei-storage` 外完整 depot（含 `data/`、`mods/`、`linux64/` 等）
- `diagnoseDstInstallReadiness` / `ensureDstLayout`：要求非空 `data/` 目录
- 验证：`reg-m1-shard` force 更新后「安装完成（本地复制）」；`data/` 存在；master 容器 `Up`

## M1 待办（非 M0 阻塞）

- 监控台容器摘要、模块 07 配置中心等见 `docs/TODO.md` §3.2
- 模块 03 已于 2026-05-20 验收；**模块 04 已于 2026-05-21 验收**（见上表）
