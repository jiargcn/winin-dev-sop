---
name: winin-sop-spec
description: 发现并加载开发规范。开发前、评审代码、diff 合规检查、修复 bug 时，按任务命中的风险点加载项目规范库中的规范文件。规范库优先 .trellis/spec/（Trellis 范式），无 Trellis 的项目用 .ai-sop/spec/（同构格式）。规范是项目实际使用的编码约定，不含运行时配置。
---

# 发现并加载开发规范

## 目标

让 AI 在写代码、评审或修复前注入项目已有规范，而不是靠记忆或事后补查。规范库是团队的知识积累（由项目负责人维护，AI 只读）：存在就用，不存在就跳过，不生成、不初始化、不要求先建库。

> 工作区尚无 `.ai-sop/` 时（刚迁移 skill 包），规范没地方放——先由入口 skill 运行 `init-env` 创建 `.ai-sop/spec/` 骨架（含 index.md 模板），再把规范放入；本 skill 只读不创建。

## 什么是规范（边界）

**规范 = 项目实际使用的编码约定**：结构/命名、数据库模式、接口契约、安全权限、错误处理、代码质量、注释要求、团队踩过的坑。记录的是"约定"而非"环境状态"。

**不是规范（从配置读取，不写进规范库）**：日志路径、数据库连接信息、token、端口、profile 等运行时配置——一律从项目配置文件（bootstrap.yaml / application-*.yaml 等）按需读取。规范库不承担"环境信息速查"职责。

范式对齐 Trellis：规范库按域分目录（`backend/` `frontend/` `guides/` 等），每域一个 `index.md` 索引表（`| 规范 | 说明 | 状态 |`），正文记录实际约定 + 代码示例 + 禁止模式 + 常见错误。

## 执行步骤

### 1. 定位规范库（按顺序尝试，不假设任何一处必有）

1. `.trellis/spec/`（Trellis 项目标准位置，如 yx-mom）
2. `.ai-sop/spec/`（无 Trellis 的项目使用；格式与 .trellis/spec 完全一致）

均不存在 → 跳过并说明（"项目无规范库，按通用工程判断"），不阻断。

### 2. 读索引

- **根级 index.md 不是必须**（Trellis 范式是每域一个 index.md）。读规范库各域目录的 `index.md`（如 `backend/index.md`、`frontend/index.md`、`guides/index.md`）获取规范清单（文件、说明、状态）；域索引也缺失时，按目录内文件名与内容自行判断。

### 3. 按风险点命中加载（语义匹配，不依赖固定文件名）

| 风险点 | 在索引中寻找 |
| --- | --- |
| 项目约定 | 说明含"结构/命名/配置/注释/生成"的规范（如 directory-structure、config-guidelines、comment-guidelines）——所有任务加载 |
| 数据库 | 说明含"数据库/ORM/查询/迁移"的规范（如 database-guidelines） |
| 公共接口/对象 | 说明含"接口/RPC/api/契约/DTO/事件/跨模块"的规范（如 rpc-guidelines、workbench-api） |
| MOM 核心 | 说明含"业务/模板/状态流转/单据"的规范（如 wms-template-*） |
| 安全权限 | 说明含"安全/权限/鉴权/敏感数据"的规范（如 security-guidelines） |
| 性能并发 | 说明含"性能/并发/锁/索引/缓存/批量"的规范 |
| 代码质量 | 说明含"质量/禁止模式/错误处理"的规范（如 quality-guidelines、error-handling） |

- 只加载命中的，控制在 2~3 个以内。
- 涉及前端（Vue 页面、接口调用、组件）时，检查 `frontend/` 子目录并加载命中规范。
- 运行时信息（日志位置、DB 连接、token）不在规范库中查找——从配置文件读取。

### 4. 记录已加载清单（写入任务 design.md 的"规范依据"小节）。

### 5. 规范与代码冲突时：以代码为准分析，把冲突记录为待确认项，不擅自按规范改写代码。

## 输出

```text
已加载规范：.trellis/spec/backend/index.md → database-guidelines.md, security-guidelines.md
依据要点：
- 数据库变更必须提供回滚脚本（database-guidelines.md §3）
- 新查询接口必须鉴权（security-guidelines.md §2）
```

## 边界

- 本 skill 只负责读取与汇总，不负责修改规范库。
- 规范缺失的领域，用通用工程判断并记录为剩余风险，不编造规范。
- 规范库的维护（沉淀新约定）是项目负责人的职责；AI 发现新约定时提示负责人更新，不直接改。
