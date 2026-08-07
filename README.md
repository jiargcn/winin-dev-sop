# winin-dev-sop：闻荫开发标准流程

`winin-dev-sop` 是面向软件需求开发和缺陷修复的 AI 协作 Skill 包。开发人员不需要记忆复杂流程，只需打开源码工作区，指定入口 Skill 和任务，AI 就会主动完成代码调研、档位推荐、任务建立、规范加载、方案设计、编码、静态检查（影响面分析）和交付总结。

两个主入口：`winin-sop-bugfix`（缺陷修复）、`winin-sop-feature`（功能开发）；另有只读问答入口 `winin-sop-explore` 与三个内部能力 `winin-sop-spec` / `winin-sop-test` / `winin-sop-review`，均可独立触发。

## 架构

```
skills/
├─ winin-sop-common/            # 共享资源（无 SKILL.md → 不被发现为 skill，不可触发）
│  ├─ workflow.md               # 共享契约：档位定义、任务协议、状态机、门禁、检索纪律、纪律
│  ├─ scripts/winin-sop.mjs     # 6 个机械命令：init / status / gate / archive / list / self-test
│  └─ assets/templates/         # 任务模板：task.json / prd.md / design.md / review.md / subtasks.md
├─ winin-sop-bugfix/            # 主入口① 缺陷处理完整流程（调研定档→三要素排查→修复→交付）
├─ winin-sop-feature/           # 主入口② 功能开发完整流程（调研定档→需求澄清→方案→实施→交付）
├─ winin-sop-explore/           # 只读问答入口：探索代码回答问题（不建任务）
├─ winin-sop-spec/              # 内部能力：发现并加载开发规范（优先 .trellis/spec/，无 Trellis 用 .ai-sop/spec/，同构：按域分目录 + index.md）
├─ winin-sop-test/              # 内部能力：单元测试环节（业务链单测，真实上下文/不 mock/回滚隔离）
└─ winin-sop-review/            # 内部能力：交付前审查（prd 比对 + 影响面 + 质量证据 + 合规；独立把关执行者）
```

入口即工作流：用户通过两个主入口 skill（bugfix / feature）进入，触发即自动获得完整流程；`winin-sop-common/workflow.md` 是被入口引用的共享契约（任务协议/状态机/门禁/纪律），各 skill 间通过统一相对引用（`../winin-sop-common/...`、`../winin-sop-spec/SKILL.md`）协作，无需额外注册或 hook 注入。

安装即复制：源码布局 = 安装目标布局（所有 skill 平铺一层，均含 SKILL.md），把 `skills/` 下全部子目录复制到平台 skill 目录即可被任何客户端发现。

## Skill 简介

### 入口层（用户直接触发）

| Skill | 职责 | 触发方式 |
| --- | --- | --- |
| **winin-sop-bugfix**（主入口①） | 缺陷处理完整流程：调研定档 → 加载规范 → 三要素排查（日志→代码→只读DB）→ 方案确认 → 修复 → 静态检查交付 → 收尾 | 用户说"修 bug/排查报错/为什么失败" |
| **winin-sop-feature**（主入口②） | 功能开发完整流程：调研定档 → 需求澄清（有预算、禁假设）→ 方案提案 → 方案确认 → 实施 → 静态检查交付 → 收尾 | 用户说"实现功能/增加筛选/修改页面逻辑" |
| **winin-sop-explore** | 只读问答：定位入口、追溯调用链和数据流，输出带代码位置证据的回答 | 用户直接提问，不建任务 |

### 内部能力层（被主入口路由调用，也可单独触发）

| Skill | 职责 | 适用场景 |
| --- | --- | --- |
| **winin-sop-spec** | 发现并加载开发规范：优先 `.trellis/spec/`（Trellis 范式：按域分目录 + index.md 索引，按风险点命中加载）；无 Trellis 的项目用 `.ai-sop/spec/`（同构格式）。规范 = 项目实际使用的编码约定，**不含运行时配置**（日志路径/DB 连接从配置文件读取）；无规范库则跳过不阻断 | 开发前、评审代码、diff 合规检查 |
| **winin-sop-test** | 单元测试环节：以业务链为单位编写真实单测并运行（完整上下文/真实数据/不 mock/回滚隔离），产出验收标准验证证据；含环境就绪检查、失败诊断流程 | 实施完成阶段、独立编写单测 |
| **winin-sop-review** | 交付前审查（唯一交付检查，静态只读）：prd 与实际改动逐条比对、影响面分析、质量与证据检查（需求遗漏/边界异常/代码卫生）、规范合规；独立把关执行者 | 交付前检查、评审他人提交、独立把关 |

### 脚本命令

脚本位于共享目录 `winin-sop-common/scripts/winin-sop.mjs`；Node.js 不可用时按相同规则人工检查，不阻断任务。

| 命令 | 职责 |
| --- | --- |
| `init-env` | 环境初始化：建 `.ai-sop/` 骨架（spec/ + tasks/ + archive/ + 索引模板），幂等不覆盖；迁移 skill 包后首次使用前执行 |
| `init` | 建任务目录 + task-state.json + 文档模板（防覆盖） |
| `status` | 状态机更新（in_progress/ready_for_review 自动校验对应门禁；completed 只能由 archive 写入） |
| `gate` | readiness / completion 门禁（产物+方案确认；验收标准全勾选；验证记录覆盖每条 AC、无 failed、skipped 须注明原因；subtasks 全勾选；不改变状态） |
| `archive` | 归档：移动任务 + 写入摘要索引 + 状态 completed |
| `list` | 列出活跃任务 |
| `self-test` | 全命令自检 |

## 四步主流程

```mermaid
flowchart LR
    A["① 调研并推荐档位"] --> B["人工确认"] --> C["建任务 + 方案<br/>L2: prd+design<br/>硬性信号: +独立把关"] --> D["② 加载开发规范"] --> E["③ 开始修改"] --> F["④ diff 分析影响面"] --> G["收尾：archive 仅用户主动"]
```

| 档位 | 判断标准 | 任务产物 | 人工确认 |
| --- | --- | --- | --- |
| L1 轻量 | 只改文案/样式/展示顺序 | 无（git diff 即记录） | 交付前确认 |
| L2 常规 | 功能新增/修改、稳定缺陷 | prd.md + design.md | 编码前方案 + 交付前 |

AI 先快速调研代码范围，基于证据推荐档位，开发人员一次确认（可一句话调整）。

## 任务产物：prd / design / review（及例外 subtasks）

L2 级别任务在**工作区根** `.ai-sop/tasks/<编号>/` 下产生文档（多 git 子仓库项目也统一放根，规范与任务全组共享），职责严格分工：prd.md（业务）、design.md（技术）、review.md（复核与交付确认），大任务另建 subtasks.md（例外）：

| 文档 | 回答的问题 | 核心内容 | 谁读、何时用 |
| --- | --- | --- | --- |
| **prd.md**（业务层） | **做什么、怎样算完成** | 目标、验收标准（AC1..ACn 编号，供测试映射与验证记录引用）、范围外、关键事实 | 交付时逐条对照验收；新会话续接时恢复上下文 |
| **design.md**（技术层） | **怎么做、做到哪了** | 现状证据、方案、实施步骤与验证、回退 | 编码时照着执行；断点恢复（第一个 `[ ]` 就是续接点） |
| **review.md**（复核层） | **凭什么说完成** | 差异检查、验收标准结果、**验证记录**（每条已勾选 AC 一条：验证方式/结果/证据，completion 门机械校验）、独立复核、交付确认 | 交付前审查；门禁机械校验输入 |
| **subtasks.md**（例外） | 大任务怎么拆 | 2~5 个同级子任务（目标/文件/依赖/对应 AC/验证方式），完成即勾选 | 跨服务/前后端+数据库/多独立验收结果时；全部勾选后才可交付 |

测试以 prd 验收标准为输入：写测试前先读 prd.md 验收标准，每条 AC 至少对应一种验证方式（业务链单测 / design 验证步骤 / 人工验证），执行后把验证记录登记到 review.md「验证记录」段（`- [x] ACn | 验证方式: ... | 结果: passed | 证据: ...`）。completion 门机械校验：每条已勾选 AC 必须有对应记录、无 failed、skipped 须说明原因；缺记录或留 failed 都过不了门。

分界规则：

- prd 管业务：验收标准是交付契约，review 审查逐条对照它给证据。
- design 管技术：调研证据直接复用为"现状证据"（不重查）；实施步骤勾选标记 `[x]`/`[ ]` 就是任务断点，新会话读它即可继续。
- 一次性事实（具体表结构、单号）不进文档，留在归档。

模板结构：

```markdown
# PRD: <任务编号> <标题>          # Design: <任务编号>
## 目标                          ## 现状证据
## 验收标准（3~8 条）              ## 方案（旧行为→新行为→不变化内容）
## 范围外                        ## 实施步骤与验证（[ ] 步骤+验证命令）
## 关键事实（涉及文件/接口/规则）   ## 回退方法
## 阻塞记录（blocked 时）          ## 规范依据（spec 加载结果）
```

例外：大任务（跨服务/前后端+数据库/多独立验收结果）拆为 `subtasks.md`（见共享契约「大任务拆解」）。L1 不产生任何文档。

## 项目落地（一次性安装）

```bash
# 1. 复制 skills/ 下全部子目录（含 winin-sop-common）到平台 skill 目录
#    pi / Codex 个人:  %USERPROFILE%\.agents\skills\   （Windows）
#    Cursor 个人:      %USERPROFILE%\.cursor\skills\
#    Claude Code 个人: %USERPROFILE%\.claude\skills\
#    项目级:           <项目>\.agents\skills\ 等（推荐，纳入版本管理）

# 2. 验证脚本可用
node <skills根>\winin-sop-common\scripts\winin-sop.mjs self-test

# 3. 初始化环境骨架（迁移后首次使用前；创建 .ai-sop/ 的 spec/tasks/archive 与索引模板）
node <skills根>\winin-sop-common\scripts\winin-sop.mjs init-env --repo <项目根>
```

规范库：无需初始化。项目已有规范（优先 `.trellis/spec/`，无 Trellis 的项目用 `.ai-sop/spec/`，两者同构：按域分目录 + index.md 索引表）会被 winin-sop-spec 自动发现并按风险点加载；规范 = 项目实际使用的编码约定（结构/命名/数据库/接口/安全/质量），**日志路径、DB 连接等运行时配置从配置文件读取，不属于规范**；没有规范库则跳过，不阻断任务。

## 使用示例：两个全流程

### 场景一：Bug 修复（制品上架报"库位代码不能为空"）

```text
用户：/winin-sop-bugfix 新增制品上架报错"库位代码不能为空"，本地已经执行，有日志

AI：（调研：读日志 → 定位代码 → 只读数据库验证）
   日志：ConstraintViolationException，Caused by ProductputawayRequestMainService.java:944
   代码：map 以 packageNumber 填充、却用 palletNumber 查询 → key 不匹配
   数据库：该单 pallet_number='P001'、location_code=NULL，与代码分析一致
   推荐档位：L2（稳定缺陷、单模块单根因），确认？

用户：确认

AI：（建任务 + 加载规范 + 方案）
   init MES-1301 → 登记档位 L2 ✓（task-state.json complexity 字段）
   winin-sop-spec：已加载 troubleshooting（日志/只读DB）、mom（上架状态）
   方案：统一 map key 来源（最小 2 行）。确认？

用户：确认

AI：（实施 + 单元测试 + diff 审查）
   最小修复 → 业务链单测通过 → diff 核对：变更 1 文件 2 行，根因修复点已变更、相邻路径未受影响，无遗漏调用方；验收标准 2/2 有验证记录（AC1/AC2 均 passed），无剩余风险。
   任务已 ready_for_review；需要归档请告知。

用户：归档

AI：MES-1301 已归档（archive）。

任务结束。

> 变体（线上问题，本地无日志）：③ 定位日志路径 → 反复确认（换关键词/时间窗口/查 .gz 归档）
> 仍无 → 停止排查，请求用户提供线上日志（模块/时间窗口/关联单号）→ 任务 blocked，
> 拿到日志后继续；禁止凭口头描述直接定位。
```

### 场景二：功能开发（工单列表组合筛选）

```text
用户：/winin-sop-feature 工单列表增加产线和计划日期组合筛选，原有筛选保持不变，
     原型在 docs/ui/workorder-filter.png

AI：（调研：定位入口 → 硬性信号扫描 → 规模估计）
   涉及 3 文件：OrderList.vue（筛选区）、WmsOrderQuery.java（DTO）、OrderQueryMapper.xml（动态 SQL）
   硬性信号：未命中（无数据库变更/公共接口/权限变化）
   推荐档位：L2（新增筛选、范围中等），确认？

用户：确认

AI：（需求澄清，有预算：只问会改变结果的问题，L2 动态 3~5 轮，够设计即停）
   锚点：现有筛选（关键字/状态），差异 = 新增 2 个条件。
   查证（不问）：产线下拉数据源、组合逻辑=AND（现有筛选 Mapper SQL 已有证据）
   第 1 问（选项式）：计划日期口径是？A 自然日（00:00-23:59）/ B 班次日 / C 工作日

用户：A，自然日

AI：（方案提案）2-3 方案带权衡：
   方案 A（推荐）：扩展现有 DTO + Mapper 动态 SQL，改动 3 文件，向后兼容，复用现有链路
   方案 B：新建独立查询接口，改动大，旧链路双维护
   方案 C：前端本地过滤，不推荐，数据量大且绕过分页
   选 A？

用户：按推荐的来

AI：（建任务 + 加载规范 + 方案）
   init MES-1234 → 登记档位 L2 ✓（task-state.json complexity 字段）
   winin-sop-spec：已加载项目约定、api（DTO 兼容策略）
   方案：DTO 加 2 字段（向后兼容）→ Mapper 动态条件（空值=不过滤）→ 前端 2 控件复用现有链路。确认？

用户：确认

AI：（实施 + 单元测试 + diff 审查）
   步骤 1/3 DTO+Mapper → mvn test passed；步骤 2/3 前端 → 页面手测单条件/组合/空值正确；
   步骤 3/3 原筛选回归通过 → diff 核对：变更 3 文件，DTO 兼容无旧调用方受影响；验收标准 3/3 有验证记录（业务链单测 + 页面手测，均 passed），规范合规 ✓。
   任务已 ready_for_review；需要归档请告知。

用户：归档

AI：MES-1234 已归档（archive）。

任务结束。
```

两个场景覆盖同一套全流程：① 调研定档（一次确认）→ ② 建任务 + 加载规范 + 方案确认 → ③ 实施 → ④ diff 影响面分析（静态检查）→ 提交代码（审核）→ 收尾（archive 仅用户主动）。

关键规则：
- 交付后开发人员一般静默通过，有异议才回复；静默即接受，任务保持 `ready_for_review`。
- 归档是用户主动行为，AI 只提示（"需要归档请告知"），不自行执行。
- 分支/worktree 由你决定：AI 创建 git 分支、worktree 前必须先征求你的意见，只给推荐不执行，以你的决定为准。
- 区别只在 ① 的调研方式（bug 走日志→代码→只读数据库三要素，功能走定位→信号扫描→规模估计）。
