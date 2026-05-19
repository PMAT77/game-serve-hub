# 接口设计规范与 API 文档

## 1. RESTful API 设计规范

### 1.1 基础约定

- 基础路径：`/app/*`（业务）与 `/api/*`（基础元信息）。
- 数据格式：`application/json`，统一响应壳。
- 鉴权头：`token`（大小写兼容），未授权返回统一错误码。

### 1.2 响应结构

```json
{
  "status": 1,
  "error": "",
  "code": "OK",
  "data": {},
  "requestId": "..."
}
```

### 1.3 设计规则

- 资源查询优先 `GET`，复杂检索可使用 `POST /.../list`。
- 动作型操作（启动、停止、更新）使用 `POST`。
- 接口字段命名保持统一，错误码可枚举。

## 2. 接口清单（当前实现）

## 2.1 认证与路由

- `GET /app/route/list`：获取菜单路由树
- `POST /app/account/login`：登录
- `POST /app/account/logout`：登出
- `GET /app/account/permission`：权限列表
- `POST /app/account/password/edit`：修改密码

### 2.2 系统能力

- `GET /app/system/settings`
- `POST /app/system/settings`
- `GET /app/system/filesystem/directories`
- `GET /app/system/filesystem/search`
- `GET /app/system/steamcmd/config`
- `POST /app/system/steamcmd/config`
- `POST /app/system/steamcmd/install`
- `GET /app/system/info`
- `GET /app/system/network/realtime`
- `GET /app/system/network/config`
- `POST /app/system/network/config`
- `POST /app/system/network/validate`
- `POST /app/system/network/apply`

### 2.3 节点能力

- `POST /app/node/local/register`
- `POST /app/node/list`

### 2.4 实例能力

- `POST /app/instance/list`
- `GET /app/instance/games`
- `GET /app/instance/install-log`
- `POST /app/instance/create`
- `POST /app/instance/check-updates`
- `POST /app/instance/update`
- `POST /app/instance/start`
- `POST /app/instance/stop`
- `POST /app/instance/restart`
- `POST /app/instance/delete`
- `POST /app/instance/metrics`

### 2.5 控制台能力

- `GET /app/instance/console/logs`
- `POST /app/instance/console/logs/clear`
- `POST /app/instance/console/command`
- `GET /app/instance/console/stream`（SSE）

### 2.6 基础能力

- `GET /health`
- `GET /api/ping`
- `GET /api/meta/runtime`

## 3. 关键接口详细定义（示例）

### 3.1 登录

- **接口**：`POST /app/account/login`
- **输入**：`{ account, password }`
- **输出**：`{ token, userInfo, mustChangePassword }`
- **异常**：账号/密码错误、账户状态异常

### 3.2 创建实例

- **接口**：`POST /app/instance/create`
- **输入**：`{ name, nodeId, gameCode, installPath?, ports? }`
- **输出**：实例基础信息与初始状态
- **异常**：参数非法、节点不可用、运行时不可用、目录冲突

### 3.3 启动实例

- **接口**：`POST /app/instance/start`
- **输入**：`{ instanceId }`
- **输出**：`{ isSuccess }`
- **异常**：实例不存在、状态不允许、容器操作失败

### 3.4 查询安装日志

- **接口**：`GET /app/instance/install-log?instanceId=...`
- **输出**：安装文本、状态摘要、进度信息
- **异常**：实例不存在、日志不可读

## 4. 接口鉴权与安全要求

- 登录外的大多数 `/app/*` 接口必须鉴权。
- 会话失效需统一触发登出流程。
- 高风险操作需记录审计信息（模块 12 规划落地）。
- 文件系统接口必须限制可访问根路径，禁止危险目录越权。

## 5. 接口版本管理策略

### 5.1 当前策略

- v1 使用无版本前缀路径，依赖变更兼容原则。

### 5.2 后续策略

- 当出现不兼容变更时，引入 `/app/v2/*` 命名空间。
- 新增字段优先后向兼容，不删除旧字段直至迁移窗口结束。
- 版本升级需同步更新：
  - API 文档
  - 前端 API 封装
  - FDS 对应章节

## 6. 规划态接口域

- 模块 03/04/05/06/07/08/10/11/12 当前为规划态，接口定义详见对应 FDS。
- 规划态接口不得在外部文档中标记为“已可用”。
