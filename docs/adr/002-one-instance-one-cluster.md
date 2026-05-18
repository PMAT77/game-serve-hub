# ADR-002：v1 一个游戏实例对应一个 DST Cluster

- **状态**：已接受  
- **日期**：2026-05-18

## 背景

DST 支持在同一 `DoNotStarveTogether` 目录下多个 Cluster 文件夹。面板需在「实例」与「房间」之间建立清晰映射，避免 UI 与备份边界模糊。

## 决策

- v1：**1 `game_instances` 行 : 1 Cluster 目录**（默认名可配置，不再写死 `Cluster_1` 为唯一）。  
- 一实例下 **1 个 Master Shard**，**0 或 1 个 Caves Shard**。  
- 不在 v1 实现「一实例多 Cluster」管理界面。

## 理由

- 与用户心智一致：「我开了一个服」= 一个实例。  
- 备份、Mod、控制台默认作用域清晰。  
- 降低 M1 表单与 API 复杂度。

## 后果

- Cluster CRUD UI 在实例上下文中操作（实例详情 Tab 或 DST 子菜单带 `instanceId`）。  
- Pro 可增强为「Cluster 模板库」复用配置，但仍按实例创建时复制为新 Cluster 目录。  
- 若未来支持一实例多 Cluster，需新 ADR 与数据模型迁移。

## 参考

- [DOMAIN.md](../DOMAIN.md)  
- [FDS-03-dst-cluster.md](../FDS/03-dst-cluster.md)
