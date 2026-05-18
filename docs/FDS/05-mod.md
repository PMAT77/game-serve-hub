# FDS-05：Steam Workshop Mod

- **里程碑**：M2  
- **优先级**：P1  
- **状态**：未实现

## 1. 背景与目标

在面板内完成创意工坊 Mod 的搜索、安装、启用/禁用、排序，并写入 DST `modoverrides.lua`，降低手动改配置成本。

## 2. 用户角色与前置条件

- 实例 `stopped` 或 `running`（**安装/卸载建议 stopped**，UI 需提示）。  
- 出站可访问 Steam Web API / Workshop。

## 3. 名词

- **Workshop ID**：Mod 数字 ID  
- **加载顺序**：`load_order` 字段，越小越先

## 4. 用户故事

1. **我希望**搜索 Mod 并查看说明，**以便**选择安装。  
2. **我希望**一键安装并调整顺序，**以便**服务器与客户端一致。  
3. **我希望**看到依赖缺失与简单冲突提示，**以便**减少进服失败。

## 5. 页面与信息架构

路径：`/dst/:instanceId/mods`（规划）

| 区域 | 功能 |
|------|------|
| 搜索栏 | 关键词、分页 |
| 结果列表 | 封面、名称、ID、订阅按钮 |
| 已安装 | 表格：名称、启用开关、顺序拖拽、卸载 |
| 详情抽屉 | 描述、依赖列表、更新时间 |

## 6. 功能点清单

| 功能 | 版本 |
|------|------|
| Workshop 搜索与详情 | Community |
| 安装/卸载到实例 | Community |
| 启用/禁用、排序 | Community |
| 写 modoverrides.lua | Community |
| 基础依赖缺失提示 | Community |
| 简单冲突提示（重复互斥 ID） | Community |
| Mod 合集、批量安装 | Pro |
| 自动检查 Mod 更新 | Pro |
| 深度冲突解析向导 | Pro |

## 7. 数据与 API

- 表：`instance_mods`（DOMAIN）  
- API：[API.md](../API.md) §7  
- 磁盘：由 DST 适配器定义 workshop 内容路径  
- 安装后提示「需重启实例生效」

## 8. 异常与边界

| 场景 | 行为 |
|------|------|
| Steam API 限流 | 提示稍后重试 |
| 安装失败 | 保留日志，DB 不记为 enabled |
| 运行中卸载 | 建议停止；若允许则警告 |
| 客户端 Mod 不匹配 | 帮助文档链接，非面板能完全解决 |

## 9. 验收标准

- [ ] 安装已知 Mod 后进服可见（[ACCEPTANCE](../ACCEPTANCE.md) E）。  
- [ ] 调整顺序后 lua 文件顺序一致。  
- [ ] Community 3 份备份策略不受 Mod 页影响。

## 10. 不在本期范围

- 本地 zip Mod 上传（P2 / Pro 扩展）  
- 客户端 Mod 自动同步

## 11. 依赖

- [FDS-02](02-node-instance.md)、[FDS-14](14-game-adapter.md) DST 路径  
- 可选 [FDS-08](08-file.md) 手工覆盖 lua

---

*实现：`server/src/modules/mod`*
