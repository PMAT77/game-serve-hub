# 安全策略

## 支持的版本

| 版本 | 支持状态 |
|------|----------|
| 最新 `v0.x` GitHub Release | ✅ 接收安全报告 |
| `main` 分支 HEAD | ✅ 接收报告（修复将随下一版本发布） |
| 更早版本 / 自行改动的 fork | ❌ 不保证 |

完整版本列表见 [Releases](https://github.com/GameServerHub/game-server-hub/releases)。

---

## 报告漏洞

**请勿在公开 Issue 中讨论可利用的安全问题。**

请通过以下方式私下报告：

1. [GitHub Security Advisories](https://github.com/GameServerHub/game-server-hub/security/advisories/new)（推荐）
2. 或新建 Issue 标题以 `[Security]` 开头并**仅写概要**，在说明中请求维护者私下联系（不推荐，响应可能较慢）

报告请尽量包含：

- 影响版本与组件（面板 / 实例容器 / 安装脚本）
- 复现步骤或 PoC
- 影响评估（认证绕过、RCE、数据泄露等）
- 是否已有缓解措施

---

## 响应预期

| 阶段 | 目标时间 |
|------|----------|
| 首次确认收到 | 7 个工作日内 |
| 严重程度评估 | 14 个工作日内 |
| 修复或缓解方案 | 视严重程度，公测阶段尽力而为 |

本项目为业余维护的公测软件，**不提供 SLA**；我们会优先处理可导致未授权访问或远程代码执行的问题。

---

## 安全最佳实践（自托管）

部署到公网或多人可访问环境时：

1. **立即修改默认密码**；启用 `FORCE_PASSWORD_CHANGE=1`
2. 生产环境显式设置 `ADMIN_PASSWORD`，勿依赖默认 `123456`
3. 面板不要直接裸露在公网；使用反向代理、防火墙或 VPN
4. 定期拉取新版本镜像并阅读 [CHANGELOG.md](CHANGELOG.md)
5. 勿将 `panel.env`、SQLite 数据库提交到公开仓库

更多安装安全提示见 [docs/INSTALL.md](docs/INSTALL.md)。
