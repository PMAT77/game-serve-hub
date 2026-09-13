# 安全策略

## 支持的版本

| 版本 | 支持状态 |
|------|----------|
| 最新 `v0.x` GitHub Release | ✅ 接收安全报告 |
| `main` 分支 HEAD | ✅ 接收报告（修复将随下一版本发布） |
| 更早版本 / 自行改动的 fork | ❌ 不保证 |

完整版本列表见 [Releases](https://github.com/PMAT77/game-serve-hub/releases)。

---

## 报告漏洞

**请勿在公开 Issue 中讨论可利用的安全问题。**

请通过以下方式私下报告：

1. [GitHub Security Advisories](https://github.com/PMAT77/game-serve-hub/security/advisories/new)（推荐）
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
2. 生产环境不要沿用模板里的示例密码：不设置 `ADMIN_PASSWORD` 时面板会随机生成强密码（读取方式见 [INSTALL.md](docs/INSTALL.md)）；`123456` 只是开发环境默认值
3. 面板不要直接裸露在公网；使用反向代理、防火墙或 VPN
4. 定期拉取新版本镜像并阅读 [CHANGELOG.md](CHANGELOG.md)
5. 勿将 `panel.env`、SQLite 数据库提交到公开仓库

### 反向代理与 HTTPS

面板默认只提供 HTTP。放到公网时建议用 Nginx / Caddy 终止 TLS 并反向代理到面板端口，注意三点：

1. 必须转发长连接：控制台日志与实时状态依赖 SSE，Nginx 需要 `proxy_buffering off;` 与 `proxy_read_timeout` 放宽，并转发 `Upgrade` / `Connection` 头。
2. 在 `panel.env` 设置 `GSH_TRUST_PROXY`（可信代理地址）。不设置时面板只能看到代理的 IP，登录限流与日志来源都会失真。
3. 代理层再加一层访问控制（IP 白名单、Basic Auth 或 VPN），比只依赖面板登录更稳妥。

更多安装安全提示见 [docs/INSTALL.md](docs/INSTALL.md)。
