# FDS-10：玩家与访问控制

- **里程碑**：M2  
- **优先级**：P1  
- **状态**：未实现

## 1. 背景与目标

管理 DST 管理员列表、白名单与封禁列表，减少手改 `adminlist.txt`、`blocklist.txt`、`whitelist.txt`。

## 2. 用户角色与前置条件

- 实例 Cluster 已存在。  
- 部分能力依赖离线房/白名单模式（cluster.ini）。

## 3. 名词

见 Klei 文档：管理员 KU_/Steam ID、白名单、封禁列表。

## 4. 用户故事

1. **我希望**添加管理员 Steam ID，**以便**在游戏内拥有管理权限。  
2. **我希望**维护白名单，**以便**仅允许好友进服。  
3. **我希望**封禁玩家，**以便**维护秩序。

## 5. 页面与信息架构

实例 Tab「玩家与访问」：

| 子页 | 文件 |
|------|------|
| 管理员 | `adminlist.txt` |
| 白名单 | `whitelist.txt` |
| 封禁 | `blocklist.txt` |

支持添加/删除行，保存写文件；提示是否需重启。

## 6. 功能点清单

| 功能 | 版本 |
|------|------|
| 管理员列表 CRUD | Community |
| 白名单 CRUD | Community |
| 封禁列表 CRUD | Community |
| 在线玩家列表（若可获取） | Community P1 |
| 临时封禁时长 | P2 |

## 7. 数据与 API

- 文件位于 Cluster 目录（具体文件名以 Klei 为准，实现时核对 [DST-OPS](../DST-OPS.md)）  
- API 规划：`/app/instances/:instanceId/access/{type}`

## 8. 异常与边界

| 场景 | 行为 |
|------|------|
| ID 格式错误 | 前端校验 |
| 与 cluster 白名单开关矛盾 | 提示先改房间设置 |

## 9. 验收标准

- [ ] 添加管理员 ID 后进服具管理权限（实测 Steam ID）。  
- [ ] 白名单外玩家无法进入（白名单房模式下）。

## 10. 不在本期范围

- 游戏内实时踢人（需控制台命令 `c_donotstarve` 等，可链到 FDS-09）  
- 跨实例共享封禁库

## 11. 依赖

- [FDS-03](03-dst-cluster.md) 房间网络模式

---

*实现：可并入 `config` 模块或独立 `access` 子模块*
