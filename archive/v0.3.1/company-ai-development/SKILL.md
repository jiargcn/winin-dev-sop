---
name: company-ai-development
description: 公司级 AI 协作开发 SOP。用于开发人员领取需求、缺陷、工程变更或新项目切片后，自动读取项目准备卡、判断工作场景、建立任务状态、按场景组织分析与编码、调用独立只读 Sidecar 复核，并通过脚本和 CI 验证完成证据。只要用户要求实现、修改、修复、排查、重构、升级或初始化软件项目，就应使用本 Skill；单纯解释、只读代码问答或不要求变更的评审不使用。
---

# 公司 AI 协作开发 SOP

## 目标

接管开发过程而不是把流程交给开发人员记忆。开发人员只负责确认业务目标、回答无法从项目资料获得的业务问题、审查关键方案与代码、确认最终业务结果。场景选择、资料检查、步骤调度、证据整理和完成门禁由本 Skill 承担。

## 核心约束

1. 始终先建立任务状态，再分析或修改代码。
2. 自动判断场景和附加风险；只有证据冲突或置信度低时才请人选择。
3. 一个任务只能有一个代码写入代理。Sidecar 始终只读，不修改文件。
4. 不把完整 SOP、全部场景和全部参考资料一次性载入上下文，只读取当前场景和实际命中的专题。
5. 业务规则、事实所有权、验收标准和高风险取舍不能由 AI 猜测。
6. Skill 指令不是确定性门禁。能由脚本、Hook 或 CI 判断的事项必须运行相应检查。
7. 不以 AI 的口头说明作为测试通过、审查通过或任务完成的证据。
8. 一条分支或 worktree 同时只处理一个活动任务；并行任务使用不同分支或 worktree，禁止共享同一任务状态和写入代理。

## 文件约定

项目根目录默认使用：

```text
.ai-sop/
├─ project-profile.json
├─ task-state.json
├─ context.json
├─ signals.json
└─ completion-report.md
```

项目可以在 `project-profile.json` 中覆盖路径。过程文件是否提交由项目准备卡决定；无论是否提交，最终 Pull Request 必须保留完成摘要。

## 执行流程

### 1. 初始化任务

1. 找到项目根目录和任务编号；没有任务编号时生成 `LOCAL-日期时间`。
2. 运行 `scripts/New-AiSopTask.ps1` 创建 `.ai-sop/task-state.json`。脚本拒绝覆盖活动任务；上一任务已经 `ready_for_review` 且任务编号不同时自动开始新任务，历史由 Git 保留。
3. 运行 `scripts/Get-AiSopProjectContext.ps1`，记录 Git 基线、工作区状态、项目结构、工具版本和项目准备卡状态。
4. 如果 `.ai-sop/project-profile.json` 不存在，运行 `scripts/New-AiSopProjectProfileDraft.ps1`，再读取 `references/project-profile.md` 校正自动草稿。只询问无法发现且会影响执行的字段。
5. 发现工作区已有改动时保留并记录，不清理、不覆盖，也不把它们自动算入当前任务。

### 2. 自动选路

1. 读取任务原文、验收标准、项目准备卡和上下文摘要。
2. 读取 `references/routing.md`，选择一个主场景：`A1`、`A2`、`A3`、`B`、`C`、`D` 或 `E`。
3. 运行 `scripts/Get-AiSopSignals.ps1`，结合任务文字和当前差异识别附加情况。
4. 把场景、理由、置信度、信号和缺失资料写入任务状态。每个命中的信号把同名 `conditionActions` 设为 `pending`；执行 `references/condition-actions.md` 对应小节后改为 `complete` 并记录证据。
5. 场景置信度为高且无冲突时自动继续；低置信度、业务规则冲突或验收标准不可观察时，只向开发人员提出最少的问题。
6. 运行 `scripts/Test-AiSopGate.ps1 -Gate route`。未通过时停止进入代码分析。

### 3. 加载当前 SOP

只读取所选场景对应的一个文件：

| 场景 | 读取文件 |
| --- | --- |
| A1 现有系统新增独立功能 | `references/scenario-a1-new-feature.md` |
| A2 修改现有页面或业务逻辑 | `references/scenario-a2-existing-change.md` |
| A3 仅修改展示性信息 | `references/scenario-a3-display-only.md` |
| B 可稳定复现缺陷 | `references/scenario-b-reproducible-bug.md` |
| C 难复现或生产偶发缺陷 | `references/scenario-c-intermittent-bug.md` |
| D 工程变更 | `references/scenario-d-engineering-change.md` |
| E 新项目首个业务切片 | `references/scenario-e-new-project-slice.md` |

存在任一附加信号时，再读取 `references/condition-actions.md` 中对应小节。不要加载无关场景。

### 4. 分析和方案

1. 先只读分析，不修改文件。
2. 输出任务复述、范围外、现状证据、影响范围、候选方案、测试设计、缺失信息和是否可以编码。
3. 每个关键结论必须指向真实文件、配置、DDL、契约、日志或测试。
4. 把确认后的分析和方案证据写入任务状态。
5. 先一次性写完任务状态中的方案证据、审批、阶段以及计划检查包和报告路径，再运行 `scripts/New-AiSopSidecarPacket.ps1` 固化任务状态、项目准备卡和方案证据。检查包生成后到实施门禁完成前不得再更新任务状态；否则检查包立即失效。再调用 Sidecar 执行 `plan` 检查，方法见 `references/sidecar-protocol.md`。
6. Sidecar 返回 `human_decision` 时，只把具体业务决策交给开发人员；返回 `block` 时补证据或修正方案。
7. 保存 Sidecar 原始 JSON 报告，先运行 `scripts/Test-AiSopSidecarReport.ps1`，再运行 `scripts/Test-AiSopGate.ps1 -Gate implementation`；两者通过后才开始写代码。

### 5. 单写入代理编码

1. 主开发代理是唯一写入者；禁止 Sidecar 或并行代理同时编辑。
2. 先建立能够判断新行为的测试或可重复验证方法，再做最小修改。
3. 每批修改后检查实际差异并运行最近层级的测试。
4. 发现范围扩大或新增附加信号时，停止当前批次，更新状态并补做对应动作。
5. 不删除正确测试、不放宽正确断言、不吞异常、不顺带重构或升级。

### 6. 验证和独立复核

1. 运行项目准备卡中的相关测试、构建和静态检查命令。
2. 再次运行 `Get-AiSopSignals.ps1` 扫描最终差异，防止风险漏判。
3. 由开发代理逐文件检查最终差异，并记录测试命令、退出码和结果位置。
4. 先一次性把任务状态更新为待评审状态，写全测试、人工差异检查、回退、最终检查包和报告路径，再运行 `New-AiSopSidecarPacket.ps1` 固化任务状态、项目准备卡、批准方案、最终 diff 和测试证据。检查包生成后到评审门禁完成前不得再更新任务状态或业务文件；再调用独立 Sidecar 执行 `final` 检查，不提供开发代理的完整对话。
5. 保存原始 Sidecar JSON 并运行报告验证器。Sidecar 未返回 `pass`、输入哈希不一致或报告过期时，不得声称具备提交条件。
6. 把最终证据写入任务状态，运行 `Test-AiSopGate.ps1 -Gate review`。
7. 运行 `New-AiSopCompletionReport.ps1` 生成完成摘要，供任务单和 Pull Request 使用。

### 7. 结束状态

只允许使用以下结论：

- `ready_for_review`：代码、测试和复核证据齐全，可提交测试或评审。
- `blocked`：缺少业务决定、授权、权威资料或环境，已写明恢复条件。
- `observing`：难复现缺陷只完成取证增强，等待部署或现场证据，不能称为已修复。
- `diagnosed`：根因已有证据，修复应作为后续任务或当前任务下一阶段继续。
- `cancelled`：任务被提出人撤回、改作实验或明确不再实施；记录原因后结束，不得声称已经交付。取消状态允许同一分支开始下一任务，不需要删除状态文件。

任务状态中的 `evidence`、`conditionActions.*.evidence` 和 `sidecar` 路径以 `.ai-sop/task-state.json` 所在目录为基准。可以写 `analysis.md`，也兼容 `.ai-sop/analysis.md`；标题锚点只用于阅读，门禁检查文件时会忽略 `#...`。阶段值只使用 Schema 中定义的 `intake`、`routed`、`analyzing`、`ready_for_implementation`、`implementing`、`verifying`、`ready_for_review`、`blocked`、`observing`、`diagnosed` 和 `cancelled`。

## Sidecar 可用性

优先使用独立子代理或独立线程作为 Sidecar。创建时不继承完整开发对话，只传路径和检查阶段，并限制为只读。

如果运行环境没有独立代理能力：

- A3 和低风险局部 B 可以由人工完成同一检查表，并在状态中记录 `manual_fallback`。
- 数据、接口、权限、MOM 核心状态、生产热修、新架构和难复现缺陷不得把同一上下文中的“自我审查”冒充独立 Sidecar；必须使用独立任务、独立评审人员或项目批准的替代方式。

## 停止条件

出现以下任一情况时停止修改，并把状态改为 `blocked` 或 `observing`：

- 任务、代码、DDL、契约或业务口径相互冲突；
- 缺少会改变业务结果的规则或验收标准；
- 需要读取密钥、未脱敏生产数据或未授权系统；
- 实际变更超出批准范围；
- 测试只能通过删除用例、降低断言或跳过构建；
- 开发人员无法解释关键代码为什么满足业务要求；
- Sidecar 或确定性门禁没有通过。

## 维护和验证

修改本 Skill 后必须：

1. 运行 Skill 的 `quick_validate.py`。
2. 运行 `scripts/Test-AiSopScripts.ps1`。
3. 至少使用 A3、A2、B、C、D 五个代表性任务做前向测试。
4. 前向测试应使用独立上下文，只提供 Skill、任务和测试仓库，不泄露预期答案。
