# 功能设计说明（FDS）索引

功能设计说明描述 **用户可见行为、边界条件与验收标准**，供产品评审与研发实现。  
名词定义见 [DOMAIN.md](../DOMAIN.md)；任务排期见 [TODO.md](../TODO.md)。

## 统一模板

每份 FDS 包含以下章节（编号可略调整）：

1. 背景与目标  
2. 用户角色与前置条件  
3. 名词（引用 DOMAIN）  
4. 用户故事 / 主流程  
5. 页面与信息架构  
6. 功能点清单（Community / Pro）  
7. 数据与文件 / API  
8. 异常与边界  
9. 验收标准  
10. 不在本期范围  
11. 依赖  

## 文档列表

| 编号 | 文件 | 里程碑 | 优先级 | 状态 |
|------|------|--------|--------|------|
| 00 | [00-install-runtime.md](00-install-runtime.md) | M0 | P0 | 部分实现（仅 A 验收） |
| 01 | [01-monitor.md](01-monitor.md) | M1 | P0 | — |
| 02 | [02-node-instance.md](02-node-instance.md) | M0/M1 | P0 | — |
| 03 | [03-dst-cluster.md](03-dst-cluster.md) | M1 | P0 | — |
| 04 | [04-dst-shard.md](04-dst-shard.md) | M1 | P0 | — |
| 05 | [05-mod.md](05-mod.md) | M2 | P1 | — |
| 06 | [06-backup.md](06-backup.md) | M2 | P1 | — |
| 07 | [07-config.md](07-config.md) | M1 | P0 | — |
| 08 | [08-file.md](08-file.md) | M2 | P1 | — |
| 09 | [09-console.md](09-console.md) | M1 | P0 | — |
| 10 | [10-player-access.md](10-player-access.md) | M2 | P1 | — |
| 13 | [13-onboarding.md](13-onboarding.md) | M2 | P1 | — |
| 14 | [14-game-adapter.md](14-game-adapter.md) | M0/M1 | P0 | — |

## 维护

- 开工前：先完成 [MODULE-KICKOFF.md](../MODULE-KICKOFF.md)；FDS 评审通过（或标注草案）。  
- 上线前：验收标准与 [ACCEPTANCE.md](../ACCEPTANCE.md) 对齐。  
- API 变更：同步 [API.md](../API.md)。
