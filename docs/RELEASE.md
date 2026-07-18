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

1. Git tag：`v0.1.2`
2. `package.json` → `"version": "0.1.2"`
3. `CHANGELOG.md` → 对应章节
4. GitHub Release 说明（镜像 tag 与升级指引）

四者在发布前必须一致。

---

## 发布检查清单

```text
[ ] CHANGELOG.md：将 [Unreleased] 内容移至新版本标题下
[ ] package.json version 与 tag 一致（不含 v 前缀）
[ ] pnpm run release:check 本地通过（lint + test:unit + build）
[ ] PR 合并后 CI 绿色
[ ] git tag v0.x.y && git push origin v0.x.y
[ ] 等待 docker-publish workflow 完成（面板 + DST 镜像）
[ ] 核对 GHCR 镜像 tag 与 GitHub Release
[ ] README / INSTALL 中如有破坏性变更，补充升级说明
```

---

## 自动发布链路

推送 **`v*`** tag 到 `main` 时：

1. [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml) 构建并推送：
   - `ghcr.io/gameserverhub/game-server-hub:<tag>`
   - `ghcr.io/gameserverhub/game-server-hub-dst:<tag>`
2. 自动创建 GitHub Release（可编辑补充说明）
3. 镜像构建参数注入 `GSH_RELEASE_VERSION`、`GSH_BUILD_SHA`

`main` 分支推送（无 tag）仅更新 `latest` 等滚动 tag，**不替代**正式版本公告。

---

## GitHub 仓库设置（维护者一次性配置）

在 **Settings → Branches → Branch protection rules** 为 `main` 启用：

| 项 | 建议 |
|----|------|
| Require a pull request before merging | ✅ |
| Require status checks to pass | ✅ |
| 必选检查项 | `Lint & Test`、`Production Build`（来自 [ci.yml](../.github/workflows/ci.yml)） |
| Require branches to be up to date | ✅（可选，减少落后 main 的绿 CI） |

配置后，外部贡献者的 PR 必须在 CI 通过后才能合并，与 [CONTRIBUTING.md](../CONTRIBUTING.md) 中的本地检查一致。

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
