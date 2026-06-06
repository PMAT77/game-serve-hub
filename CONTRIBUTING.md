# 参与贡献

感谢关注 Game Server Hub。本文说明如何有效地提交 Issue 与 Pull Request。

---

## 开始之前

1. 阅读 [README.md](README.md) 了解项目定位（当前为 **v0.x 公测**，DST 优先）
2. 查阅 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) 搭建本地环境
3. 大改动请先开 [Issue](https://github.com/GameServerHub/game-server-hub/issues) 讨论，避免重复劳动

---

## 报告 Bug

使用 [Bug 报告模板](.github/ISSUE_TEMPLATE/bug_report.yml)，并尽量提供：

- 操作系统与 Node / Docker 版本
- 复现步骤
- 期望行为 vs 实际行为
- 相关日志（脱敏后）

安全问题请勿公开 Issue，见 [SECURITY.md](SECURITY.md)。

---

## 提交 Pull Request

### 1. Fork 与分支

```bash
git checkout -b feat/your-topic
# 或 fix/your-topic
```

### 2. 本地检查（与 CI 一致）

```bash
pnpm install
pnpm run lint
pnpm test:unit
```

涉及前端构建时额外执行：

```bash
pnpm run build
```

### 3. 变更范围

- **保持 PR 聚焦**：一个 PR 解决一类问题
- **匹配现有风格**：Composition API、TypeScript、现有目录约定
- **不要提交**：`panel.env`、`.env*` 凭据、本地 SQLite、`docs_local/`、密钥

### 4. 提交信息

Conventional Commits，中文 subject 示例：

```text
fix(auth): 强制改密流程补全路由注册
docs(release): 添加版本发布说明
ci: PR 门禁执行 lint 与 test:unit
```

### 5. CHANGELOG

用户可见变更请写入 [CHANGELOG.md](CHANGELOG.md) 的 **`[Unreleased]`** 小节（`feat` / `fix` / `Security` 等）。

### 6. 打开 PR

使用 [PR 模板](.github/pull_request_template.md)，说明动机、测试方式与关联 Issue。

---

## Code Review 原则

维护者会关注：

- 行为是否正确、边界是否处理
- 是否引入不必要的抽象或范围膨胀
- 测试是否覆盖真实逻辑（非琐碎断言）
- 文档与 CHANGELOG 是否同步

---

## 行为准则

参与本项目即表示同意 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

---

## 许可证

贡献代码以 [MIT License](LICENSE) 发布；你保留对原创内容的版权。
