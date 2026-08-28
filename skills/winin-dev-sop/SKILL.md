---
name: winin-dev-sop
description: 闻荫开发标准流程。用于在源码工作区内完成功能新增、现有功能修改、简单修改、缺陷排查与修复，并覆盖方案、编码、测试和交付准备。用户要求实现需求、修复缺陷、修改页面或逻辑、排查生产问题时使用；只读问答、纯解释或不要求修改的评审不使用。
---

# 闻荫开发标准流程

## 目标

接管开发流程，让不同 AI 使用水平的开发人员都能更快、更稳地完成任务。让开发人员聚焦业务目标、关键取舍和最终结果；由本 Skill 负责检查资料、选择流程、组织方案、实施验证和整理总结。

## 基本原则

1. 先检查能否开始，再分析和修改代码。
2. 只加载当前场景和实际风险需要的资料。
3. 不猜测业务规则、验收标准和事实所有权。
4. 一个工作目录同时只处理一个任务，只允许一个代理写代码。
5. AI 的说明不等于完成证据；必须检查实际差异并执行测试或可重复验证。
6. 不输入密钥、凭据、未脱敏生产数据或无权使用的客户资料。
7. 保留用户已有修改，不擅自清理、覆盖或混入当前任务。
8. 实施代理不得把自己写成确认人，也不得把 `plan.approved` 或 `review.humanApproved` 自行改为 `true`。

## 如何解析 skill-dir

`skill-dir` 是**本文件 `SKILL.md` 所在目录**（已安装 Skill 的根目录），不是业务仓库根目录。

1. 你正在读取本文件，因此 `skill-dir` = 本 `SKILL.md` 的父目录。
2. 不要猜测 `~/.cursor`、`~/.claude` 或 `~/.agents`：三个位置都可能有旧副本，猜错会跑到未安装或不完整的 Skill。
3. 不要用业务仓库根目录替换 `skill-dir`。只有当本 Skill 以项目级方式安装在仓库内（例如 `<repo>/.cursor/skills/winin-dev-sop`）时，那个安装目录才是 `skill-dir`。
4. Node.js 可用时，用正在执行的这份脚本核对：

   ```text
   node <本 SKILL.md 所在目录>/scripts/winin-sop.mjs skill-dir
   ```

   该命令打印 Skill 根目录。任务资料仍写在业务仓库的 `.ai-sop/tasks/<task-id>/`。

下文命令中的 `<skill-dir>` 一律按此解析。`<repo-root>` 才是业务源码根目录。

## 任务状态约定（schemaVersion 1.1）

每个任务一份 `.ai-sop/tasks/<task-id>/task-state.json`。1.1 相对 1.0 增加 `changes.files`、`plan`/`review` 的 `confirmationPhrase` 与 `shownToHuman`。旧任务仍可读取；完成门禁会要求确认证据和变更证据。

| 场景中文 | `scenario` |
| --- | --- |
| 新增功能 | `new-feature` |
| 修改现有功能 | `existing-change` |
| 简单修改 | `simple-change` |
| 缺陷处理 | `bug` |
| 尚未选择 | `unclassified`（init 默认；不得带着它做方案或编码） |

选中 `simple-change` 时必须把 `plan.approvalRequired` 设为 `false`，并跳过方案确认。其他场景保持 `plan.approvalRequired=true`，编码前必须有开发人员确认。门禁也按场景判断：简单修改即使忘了改 `approvalRequired`，实施门禁仍不要求 `plan.approved`。

## 人工确认必须是开发人员的回复

实施代理禁止把 `plan.approved` 或 `review.humanApproved` 自行设为 `true`，禁止把 `approvedBy` 写成 `ai`、模型名或“助手”。

| 节点 | 谁确认 | 有效回复 | 无效回复 |
| --- | --- | --- | --- |
| 方案确认（非简单修改） | 当前对话中的开发人员 | `确认方案`，或复述已展示的目标/范围/方案/测试设计后的明确同意 | 只说 `ok` / `好的` / `可以`，且此前未完整展示 |
| 最终确认（所有任务） | 当前对话中的开发人员 | `确认结果`，或复述已展示内容后的明确同意 | 只说 `ok` 等，且未先看到目标、文件级差异、验收结果、测试、未执行项、剩余风险 |

记录规则：

- `approvedBy`：开发人员（可写其显示名；不能是 AI）
- `approvedAt`：ISO 时间
- `confirmationPhrase`：开发人员的原话
- `shownToHuman`：确认前实际展示过的内容摘要

先展示，再等待回复，再写上述字段。没有回复就保持 `false` 并停止在确认点。

## 三道门禁

Node.js 18+ 可用时按下面命令执行；**不可用时不得阻断任务**，必须按同一字段清单手工检查。

| 时机 | 命令 | 未通过时 |
| --- | --- | --- |
| 场景已选定、开始方案设计前 | `node <skill-dir>/scripts/winin-sop.mjs gate --task-dir <task-dir> --name readiness` | 停止设计，只补必要资料 |
| 方案（及必要的确认）完成后、开始编码前 | `node <skill-dir>/scripts/winin-sop.mjs gate --task-dir <task-dir> --name implementation` | 不得写业务代码 |
| 对外声称 `ready_for_review` 前 | `node <skill-dir>/scripts/winin-sop.mjs gate --task-dir <task-dir> --name completion` | 把 `status` 改回 `implementing` 或 `blocked`，禁止声称完成 |

手工门禁与脚本相同：

- 开工：`goal`、`acceptanceCriteria`、`baseline.commit`、`scenario` 不是 `unclassified`、`inputs.missing` 为空
- 实施：上项 + `plan.md` + `test-design.md`；非 `simple-change` 还须有方案确认证据
- 完成：上项 + `tests.executions` 无 `failed` 且至少一条 `passed` + `review.md` + 如需则独立复核已完成 + 最终确认证据 + 文件级变更证据（git diff 相对 `baseline.commit`，或已写入 `changes.files`）+ `status=ready_for_review` + 非空 `nextAction`

## 第一步：识别运行能力

根据当前 Agent 工具和模型能力选择模式，不因为缺少子代理而阻断普通任务：

| 模式 | 条件 | 执行方式 |
| --- | --- | --- |
| 基础 | 无独立子代理，或模型难以稳定处理长上下文 | 主代理按步骤执行；增加人工方案确认；最终由人检查差异 |
| 标准 | 能稳定分析代码，可启动一个独立只读审查上下文 | 主代理实施；中高风险任务增加一次独立复核 |
| 增强 | 支持独立子代理或独立任务，任务风险较高 | 主代理实施；方案或最终结果由只读审查者复核 |

不要把平台专用的子代理命令写入任务产物。需要独立复核时，按 [复核规则](references/review-protocol.md) 选择 Cursor / Claude Code / Codex 配方；做不到则降级为开发人员检查表，禁止用同一实施对话冒充独立复核。

本步更新 `task-state.json`：

- `executionMode`：`basic` / `standard` / `enhanced`
- `updatedAt`

## 第二步：建立独立任务

1. 获取任务编号和标题；没有编号时生成 `LOCAL-日期时间`。
2. 默认使用 `.ai-sop/tasks/<task-id>/` 保存当前任务资料，不复用其他任务目录。`<task-dir>` 即该目录的绝对路径。
3. Node.js 18 或更高版本可用时，运行：

   ```text
   node <skill-dir>/scripts/winin-sop.mjs init --repo <repo-root> --task <task-id> --title <title>
   ```

4. Node.js 不可用时，把 `<skill-dir>/assets/task-state.template.json` 复制到任务目录并命名为 `task-state.json`，再填写相同任务资料；不要因此阻断任务。
5. 记录当前分支、基线提交和已有未提交修改。已有修改不能自动视为当前任务内容。

本步更新：

- `taskId`、`title`
- `baseline.branch`、`baseline.commit`（非 Git 写 `NO_GIT_BASELINE`）、`baseline.workingTreeInitiallyDirty`
- `status=intake`
- `nextAction=完成开工检查`
- `createdAt`、`updatedAt`

init 默认 `scenario=unclassified`、`plan.approvalRequired=true`。这是预期起点，不是简单修改的最终值。

## 第三步：检查开工条件

读取 [开工检查](references/readiness.md)，按任务实际需要判断资料。一次性告诉开发人员：缺什么、为什么需要、由谁提供、是否可以豁免。

只有以下条件同时满足时才进入方案设计：

- 目标和可观察的验收标准明确；
- 代码基线及已有修改已识别；
- 会改变结果的业务规则不存在冲突；
- 当前任务真正需要的代码、原型、截图、日志、DDL或契约已经取得，或已记录人工豁免；
- 已明确如何验证任务完成。

必要资料缺失时停止推进，只请求最少的补充信息。不要机械要求每个任务都提供知识图谱、原型、DDL或完整设计文档。

本步更新：

- `goal`、`acceptanceCriteria`、`outOfScope`
- `inputs.available`、`inputs.missing`、`inputs.waived`（缺必要资料时 `status=blocked`，`nextAction` 写清要谁补什么）
- 资料齐时 `nextAction=选择工作场景`
- `updatedAt`

本步还不必跑开工门禁：门禁要求已选定场景。先完成本步字段，再进入第四步。

## 第四步：自动选择一个场景

根据任务主要目的只读取一个场景文件：

| 场景 | 判断方式 | 文件 | `scenario` |
| --- | --- | --- | --- |
| 新增功能 | 现有系统中增加原来不存在的业务能力 | [新增功能](references/scenario-new-feature.md) | `new-feature` |
| 修改现有功能 | 改变已有页面、逻辑、流程、状态或校验 | [修改现有功能](references/scenario-existing-change.md) | `existing-change` |
| 简单修改 | 只改文案、样式、展示顺序等，不改变数据、接口和业务行为 | [简单修改](references/scenario-simple-change.md) | `simple-change` |
| 缺陷处理 | 当前行为与已确认正确结果不一致，或需要排查异常 | [缺陷处理](references/scenario-bug.md) | `bug` |

场景不清时优先依据期望结果判断，不要求开发人员记忆或选择场景编号。

本步更新：

- `scenario`：上表四个值之一，不得停留在 `unclassified`
- 若 `simple-change`：`plan.approvalRequired=false`（跳过方案确认，`plan.approved` 保持 `false`）
- 其他场景：`plan.approvalRequired=true`
- `nextAction=识别附加动作`
- `updatedAt`

## 第五步：识别附加动作

检查数据库、公共接口或公共对象、MOM 核心事实、安全权限、性能并发、生产偶发六类信号。命中时只读取 [附加动作](references/risk-actions.md) 中的对应小节，并把增加的动作写入计划。

本步更新：

- `riskSignals`：命中的信号名数组；未命中写 `[]`
- 命中数据库 / 公共接口或对象 / MOM / 安全 / 性能并发 / 生产偶发 / 大范围或难回退时：`review.independentRequired=true`
- `nextAction=控制任务规模` 或 `运行开工门禁后设计方案`
- `updatedAt`

场景与风险写完后、开始方案设计前运行 **readiness** 门禁。

## 第六步：控制任务规模

当任务跨多个服务、同时涉及前后端和数据库、包含多个可独立验收结果，或一次修改难以安全复核时：

1. 创建 `subtasks.md`，拆成 2 至 5 个可独立验证的同级子任务。
2. 写明每个子任务的输入、输出、依赖和验收结果。
3. 请开发人员确认拆分和执行顺序。
4. 每次只实施一个子任务；需要并行写代码时使用独立分支或 worktree。
5. 第一版不做递归多级拆分，不让子代理继续创建子代理。

本步更新：`nextAction`（当前子任务）、`updatedAt`。无拆分则直接进入方案设计。

## 第七步：方案和测试设计

1. 先只读分析代码、调用关系、现有测试和相关资料。
2. 在 `plan.md` 中写清目标、范围外、现状证据、修改位置、关键规则、回退方法和实施顺序。
3. 在 `test-design.md` 中把每条验收标准映射到测试或可重复验证方法。
4. 非简单修改必须向开发人员展示方案和测试设计，得到确认后才能编码。展示时写入 `plan.shownToHuman`（`goal`、`plan`、`testDesign`、`scope`），然后等待回复 `确认方案`。只有收到有效回复后，才可把 `plan.approved=true`，并填写 `approvedBy`（开发人员）、`approvedAt`、`confirmationPhrase`（原话）。
5. 简单修改可以自动继续，但仍需记录验证方法；不要把 `plan.approved` 设为 `true`。

出现以下情况时，无论原场景如何都必须重新请求确认：变更超出原范围、修改公共对象或公共接口、增加数据库变化、改变 MOM 核心状态或无法安全回退。旧确认作废：把 `plan.approved` 和（若已做最终确认）`review.humanApproved` 改回 `false` 并清空确认证据。

本步更新：

- `plan.path=plan.md`（文件必须存在）
- `tests.designPath=test-design.md`
- 方案确认字段（仅非简单修改且已收到人的回复时）
- `status=planning`，确认后或简单修改可改为准备实施
- `nextAction=运行实施门禁后编码` 或 `等待开发人员回复确认方案`
- `updatedAt`

编码前运行 **implementation** 门禁。

## 第八步：实施和逐轮验证

1. 只有主开发代理可以写代码。
2. 优先建立失败测试、特征测试或可重复验证方法，再做最小修改。
3. 每批修改后检查实际差异并运行最近层级的测试。
4. 不删除正确测试、不降低正确断言、不吞异常、不跳过必要构建，也不顺带重构无关代码。
5. 发现范围扩大或新风险时立即停止当前批次，回到方案确认。

本步更新：

- `tests.executions`：追加 `{ command, result, note }`，`result` 为 `passed` / `failed` / `not_run`
- `changes.files`：文件级清单（如 `{ "path": "src/a.vue", "kind": "modified" }`）。有 Git 时仍建议记录；无 Git 时这是完成门禁的唯一变更证据
- `changes.note`：可选说明
- `status=implementing`
- `nextAction=继续验证` 或 `准备复核`
- `updatedAt`

## 第九步：复核和完成

1. 运行项目相关测试、构建和静态检查；无法执行的项目必须写明原因和风险。
2. 逐文件检查最终差异，确认没有混入其他任务或无关修改。有 Git 时对 `baseline.commit` 做 `git diff`；无 Git 时核对照 `changes.files`。
3. 根据 [复核规则](references/review-protocol.md) 判断是否需要独立复核。独立复核者只返回问题和证据，不得改代码，不得写 `humanApproved`。平台配方见该文件；做不到则请开发人员按检查表执行，禁止实施代理自评后勾选独立复核。
4. 向开发人员展示目标、文件级差异、验收标准完成情况、测试命令与结果、未执行项、剩余风险和下一步。把这些摘要写入 `review.shownToHuman`（`goal`、`diff`、`acceptanceResults`、`tests`、`skipped`、`remainingRisks`）。未完整展示前，开发人员只回 `ok` **不算**最终确认。
5. 等待开发人员回复 `确认结果`。收到有效回复后才可设置 `review.humanApproved=true`、`approvedBy`（开发人员）、`approvedAt`、`confirmationPhrase`。
6. 将 `status` 设为 `ready_for_review`，填写 `nextAction` 后立即运行完成门禁；未通过则改回 `implementing` 或 `blocked`，不得在对话中声称完成：

   ```text
   node <skill-dir>/scripts/winin-sop.mjs gate --task-dir <task-dir> --name completion
   node <skill-dir>/scripts/winin-sop.mjs summary --task-dir <task-dir>
   ```

7. Node.js 不可用时，按 `task-state.json` 的相同字段人工检查并生成 `completion-report.md`。总结必须包含实际修改（文件级差异或已记录文件清单）。

独立复核完成后由实施代理根据复核者返回的结论更新：`review.independentCompleted=true`（仅在确实做了独立复核或开发人员检查表之后）。复核者本人不要改 `task-state.json`。

本步还更新：`review.path`、`remainingRisks`、`updatedAt`。

最终总结必须包含任务目标、实际修改、验收标准逐项结果、测试命令与结果、未执行项、剩余风险、人工确认和明确的下一步动作。对照形状可见 `<skill-dir>/assets/examples/simple-change-label-rename/`（示例数据，不是活任务）。

## 结束状态

- `ready_for_review`：具备提交测试或代码评审的条件。
- `blocked`：缺少业务决定、必要资料、权限或环境，并已写明恢复条件。
- `observing`：难复现缺陷只完成取证增强，正在等待现场证据，不能称为已修复。
- `cancelled`：任务撤回或仅用于实验，不得声称已经交付。
