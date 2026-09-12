# 版本与发布

面向维护者与发布负责人的操作说明。用户升级请参阅 [INSTALL.md](INSTALL.md)。

---

## 版本策略（Pre-1.0）

| 阶段 | 规则 |
|------|------|
| 当前 | **v0.x 公测**，`1.0.0` 前不承诺 API/配置向后兼容 |
| 版本号 | [SemVer](https://semver.org/lang/zh-CN/)：`MAJOR.MINOR.PATCH` |
| `0.x.y` | `y` = 修复；`x` = 功能/较大改动（可在 Release Notes 标明破坏性变更） |
| `1.0.0` | 首个「稳定版」里程碑，需单独公告兼容策略 |

**单一事实来源：**

1. Git tag：`v0.3.10`
2. `package.json` → `"version": "0.3.10"`
3. `CHANGELOG.md` → 对应章节
4. GitHub Release 说明（镜像 tag 与升级指引）

四者必须一致。**开发期间 `package.json` 的 version 应与最新已发布 tag 保持一致**——不要在功能提交里顺手 bump 版本号，也不要预写带日期的 CHANGELOG 发布章节。

原因：镜像引用（`docker-compose.yml`、`panel.env.example`、`install.linux.sh` 等 6 处）指向的是**已发布**版本，一旦 `package.json` 提前 bump，`pnpm run release:verify` 就会失败，而它在每次推送到 `main` 时都会执行 —— CI 会从那一刻起持续变红，掩盖这期间真正的回归。

版本号、CHANGELOG 发布章节与全部镜像引用应在**发布日一次性更新**，见下方检查清单。

---

## 发布检查清单

```text
[ ] CHANGELOG.md：将 [Unreleased] 内容移至新版本标题下
[ ] package.json version 与 tag 一致（不含 v 前缀）
[ ] 同步 install.linux.sh 内置的 compose 校验和（INSTALLER_ASSET_SHA256_DOCKER_COMPOSE_YML / _BIND_YML）
      —— 已由 `pnpm run release:verify`（scripts/check-release-consistency.mjs）强制校验，失配会直接给出新摘要
[ ] 同步 7 处版本引用（两份 compose、panel.env.example、server/src/shared/config/index.ts、README、docs/INSTALL.md）
[ ] pnpm run release:check 本地通过（lint + test:unit + build）
[ ] PR 合并后 CI 绿色
[ ] git tag v0.x.y && git push origin v0.x.y
[ ] 首次发布后：在 GHCR Package settings 的 Manage Actions access 授予本仓库写权限（否则 candidate 清理会 403）
[ ] （可选）发布后在 Release 页确认离线镜像包 `game-server-hub-<tag>-docker-image.tar.gz` 已上传
[ ] 等待 Container Pipeline 完成（统一镜像验证 → candidate → 正式 tag）
[ ] 核对 GHCR 统一镜像 tag、`release-images.json` 与 GitHub Release（含离线镜像包）
[ ] README / INSTALL 中如有破坏性变更，补充升级说明
```

---

## 自动发布链路

仅在推送 **`v*`** Release tag 时：

1. [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml) 先执行发布质量门禁（类型检查、版本一致性、单测、安装脚本 smoke test、生产构建），再构建并推送统一镜像 candidate：
   - `ghcr.io/pmat77/game-server-hub:<tag>`（面板 + DST 运行环境 + SteamCMD 三合一，Dockerfile：`docker/unified/Dockerfile`）
2. candidate 写入成功后才提升正式 tag，避免部分 Release
3. 镜像仅发布 GHCR；国内分发依赖 Release 离线镜像包与加速代理（与上游参考项目的单源分发一致）
4. 自动创建 GitHub Release 并附带 `release-images.json` 与离线镜像包 `game-server-hub-<tag>-docker-image.tar.gz`（含 `.sha256`）
5. Release 创建成功后自动清理本次 candidate 镜像，避免 GHCR 存储持续累积
6. 镜像附带 provenance、SBOM，并注入 `GSH_RELEASE_VERSION`、`GSH_BUILD_SHA`

PR 仅执行轻量质量检查，不构建或推送容器镜像；`main` 分支推送不会产生滚动镜像 tag。安装与升级应始终使用正式版本 tag 或 `release-images.json` 中的 digest。

---

## GitHub 仓库设置（维护者一次性配置）

在 **Settings → Branches → Branch protection rules** 为 `main` 启用：

| 项 | 建议 |
|----|------|
| Require a pull request before merging | ✅ |
| Require status checks to pass | ✅ |
| 必选检查项 | `Quality Gate`（PR 质量门禁） |
| Require branches to be up to date | ✅（可选，减少落后 main 的绿 CI） |

配置后，外部贡献者的 PR 必须在 CI 通过后才能合并，与 [CONTRIBUTING.md](../CONTRIBUTING.md) 中的本地检查一致。

GHCR 的 `game-server-hub` Package 需在 Package settings 的 **Manage Actions access** 中授予 `PMAT77/game-serve-hub` 写权限，并设置为 Public。工作流只使用仓库临时 `GITHUB_TOKEN`，不需要长期 PAT。

---

## 提交信息约定

采用 [Conventional Commits](https://www.conventionalcommits.org/)（中文 subject 可接受），便于生成 Release Notes：

```text
feat(instance): 支持批量检查更新
fix(auth): 强制改密后保留当前会话
docs(install): 补充 CORS_ORIGIN 说明
chore(ci): 添加 PR 质量门禁
```

类型：`feat` `fix` `docs` `chore` `refactor` `test` `perf` `ci`

---

## 破坏性变更

Pre-1.0 阶段若引入破坏性变更，请在同一版本 Release 中明确列出：

- 影响模块
- 配置 / 环境变量迁移
- 数据库迁移说明
- 回滚建议

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [CHANGELOG.md](../CHANGELOG.md) | 用户可见变更记录 |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献流程 |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 本地开发与测试 |
