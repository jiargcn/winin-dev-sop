# 闻荫开发标准流程（共享契约）

本文档是流程的共享部分：任务协议、档位定义、状态机、门禁、检索纪律和不可妥协的纪律。完整流程在入口 skill 中（缺陷处理 → winin-sop-bugfix；功能开发 → winin-sop-feature），入口 skill 引用本契约执行。

## 入口

| 用户意图 | 入口 skill | 流程 |
| --- | --- | --- |
| 修 bug / 排查异常 / 报错 | winin-sop-bugfix | 调研定档 → 三要素排查 → 修复 → 交付 |
| 新增/修改功能 | winin-sop-feature | 调研定档 → 需求澄清 → 方案 → 实施 → 交付 |
| 只读问答（"X 怎么实现的"） | winin-sop-explore | 分析回答，不建任务 |

## 目标

让不同 AI 使用水平的开发人员都能更快、更稳地把任务推进到可提交评审的状态。AI 负责流程组织，开发人员只做两次确认。

## 基本原则

1. 先检查能否开始，再分析和修改代码。
2. 只加载当前任务实际需要的资料和规范。
3. 不猜测业务规则、验收标准和事实所有权。
4. 一个工作目录同时只处理一个任务，只允许一个代理写代码。
5. AI 的说明不等于完成证据；必须检查实际差异并逐条核对验收标准。
6. 不输入密钥、凭据、未脱敏生产数据或无权使用的客户资料。
7. 保留用户已有修改，不擅自清理、覆盖或混入当前任务。

## 复杂度档位（两入口共用）

| 档位 | 判断标准 | 任务产物 | 人工确认 |
| --- | --- | --- | --- |
| **L1 轻量** | 只改文案/样式/展示顺序，不动数据、接口、业务行为 | 无（git diff 即记录） | 仅交付前静默通过 |
| **L2 常规** | 功能新增/修改、稳定缺陷 | `task-state.json` + `prd.md` + `design.md` | 编码前方案确认 + 交付前 |

交付前独立把关（AI 内部机制，用户无需选择或理解）：命中任一硬性信号（数据库/公共接口/MOM/安全/跨服务）、用户表达更谨慎的意愿（如"仔细一点""稳妥些"）、或排查中确认难复现（取证观察）时，置 `independentReview: true`，交付前由独立只读上下文复核（review.md 勾选）。用户只会看到调研摘要里的一句话（如"涉及数据库变更，交付前会加一道独立把关"），不要求理解机制或做选择。

- 档位由 AI 调研后推荐、人工确认（可一句话调整）；确认后写入 task-state.json。
- 实施中命中硬性信号 → 暂停，重新请人工裁决，并自动置 `independentReview: true`。

## 任务协议

### 目录结构

`.ai-sop/` 位于**工作区根**（无论根是否 git 仓库；多 git 子仓库项目如 yx-mom 也统一放根，规范与任务全组共享）。**迁移 skill 包后、首次使用前，显式执行 `init-env` 创建环境骨架**（含 spec/ 目录与索引模板，让规范有地方放）：

```text
node <skills根>/winin-sop-common/scripts/winin-sop.mjs init-env --repo <工作区根>
```

```
.ai-sop/
├─ spec/                    # 团队规范（可选；仅无 Trellis 的项目使用，结构对齐 .trellis/spec：按域分目录，每域 index.md，根级非必须）
│  └─ backend/index.md      # 域规范索引（frontend/ guides/ 同构）
├─ tasks/<任务编号>/        # 活跃区：未归档任务（默认检索范围）
│  ├─ task-state.json       # 定位层：状态 + 基线 + 档位（唯一 JSON；其余一律在 md）
│  ├─ prd.md                # 业务层：目标 + 验收标准 + 范围外 + 待确认项 + 关键事实
│  ├─ design.md             # 技术层：现状证据 + 方案 + 实施步骤与验证 + 回退 + 方案确认
│  ├─ review.md             # 复核层：差异检查 + 验收结果 + 验证记录 + 独立复核（条件）+ 交付确认
│  └─ subtasks.md           # 仅大任务拆解时（例外，见「大任务拆解」）
├─ archive/                 # 历史区：已归档任务（默认不进入任何检索）
│  └─ index.md              # 摘要索引（一行/任务）
```

### task-state.json（定位层，仅 7 字段）

```json
{
  "taskId": "MES-1234",
  "title": "任务标题",
  "status": "planning",
  "complexity": { "level": "L2", "reason": "调研摘要", "confirmedBy": "", "confirmedAt": "" },
  "independentReview": false,
  "baseline": {
    "branch": "", "commit": "", "workingTreeInitiallyDirty": false,
    "repos": []
  },
  "createdAt": "", "updatedAt": ""
}
```

**基线两种形态（init 自动探测，AI 不改）**：

- 工作区根是 git 仓库 → 单仓库基线（branch/commit/workingTreeInitiallyDirty）。
- 工作区根不是 git（如 yx-mom：mom/win-module-* 各自独立仓库）→ 扫描根下直接子目录中的 git 仓库，全部记入 `baseline.repos`（`{ repo, branch, commit, workingTreeInitiallyDirty }`）。
- diff 审查与断点恢复按**任务涉及仓库**逐个 `git diff <commit>`；涉及仓库从 design.md 文件清单判断。

验收标准、复核证据分别记录在 prd.md / review.md，不重复写入 JSON；档位确认后直接编辑 complexity 字段，命中硬性信号/难复现时置 `independentReview: true`（AI 维护，无单独命令）。

- 状态机：`planning → in_progress → ready_for_review → completed(归档)`；例外：`blocked`（缺资料/决定，恢复条件写 prd.md 阻塞记录）、`observing`（尝试复现失败，取证中）。
- 下一步推断（不维护 nextAction）：planning → 等人确认方案；in_progress → subtasks.md 第一个未勾选子任务（若存在），否则 design.md 第一个未勾选步骤；ready_for_review → 等用户归档指令；blocked → 等恢复条件。

### 任务编号

- 用户有任务单编号就用它（如 MES-1234）；多数情况下用户只给任务描述，AI 自动生成 `LOCAL-日期时间`；目录名 = 编号，编号即唯一标识。
- 新会话恢复：用户给编号 → 读 `tasks/<编号>/task-state.json` → 读 prd/design → git status 对照基线（按任务涉及仓库逐个对照） → 按状态推断断点。

### 大任务拆解（subtasks.md，例外）

任务跨多个服务、同时涉及前后端与数据库、包含多个可独立验收结果，或一次修改难以安全复核时，拆成 2~5 个可独立验证的同级子任务：

1. 建 `subtasks.md`：每个子任务写明目标、涉及文件、依赖、对应验收标准（AC 编号）与验证方式。
2. 子任务清单与执行顺序随方案一并请开发人员确认（计入方案确认，不另加确认次数）。
3. 每次只实施一个子任务；完成即勾选 `[x]` 并记录验证结果，再开始下一个。
4. 子任务全部勾选后，prd.md 验收标准逐条勾选，进入 diff 审查。
5. 当前版本不做递归多级拆分，不允许子代理继续创建子代理。子任务默认串行推进：同一工作区内同一时刻只实施一个子任务（与纪律 1「只有主开发代理可以写代码」一致）。
   - 跨独立子仓库的子任务（如 wms 与 mes 分属不同 git 仓库）天然互不干扰，各自提交、各自验证即可，无需额外分支或 worktree。
   - 确需多人/多代理并行（超出单代理范围）时，各自使用独立的仓库副本或互不重叠的独立子仓库分支；不在同一仓库上使用 worktree 并行，worktree 共享 refs，且门禁产物（.ai-sop/）、日志与基线 diff 会互相干扰，对 AI 协作无收益。
   - 任何分支/worktree 创建必须先征求用户意见，只做推荐不执行（纪律 8）。

### 门禁（Node.js 可用时）

脚本位于共享目录 `winin-sop-common/scripts/winin-sop.mjs`（从入口 skill 看相对路径为 `../winin-sop-common/scripts/winin-sop.mjs`；以下用 `<skills根>/winin-sop-common/` 表示其所在位置）：

```text
node <skills根>/winin-sop-common/scripts/winin-sop.mjs init-env --repo <root>   # 环境初始化（首次使用前）
node <skills根>/winin-sop-common/scripts/winin-sop.mjs init --repo <root> --task <id> --title <title>
node <skills根>/winin-sop-common/scripts/winin-sop.mjs status --repo <root> --task <id> --state <状态>
node <skills根>/winin-sop-common/scripts/winin-sop.mjs gate --task-dir <dir> --name readiness|completion
node <skills根>/winin-sop-common/scripts/winin-sop.mjs archive --repo <root> --task <id>
node <skills根>/winin-sop-common/scripts/winin-sop.mjs list --repo <root>
```

- `init-env`：显式初始化环境骨架（`.ai-sop/spec/` + `tasks/` + `archive/` + 说明文档），幂等不覆盖；迁移 skill 包后、首次使用前执行。tasks/archive 仍由任务 init/archive 自动创建。

- 状态机自动绑定门禁：`status --state in_progress` 自动校验 readiness 门；`status --state ready_for_review` 自动校验 completion 门，不过拒绝切换并列出缺失项；blocked / observing 为等待态，切换不校验；completed 只能由 archive 写入。
- readiness 门：产物存在（prd.md + design.md）+ design.md「方案确认」标记勾选（L1 不建任务，无门禁）。
- 基线门（init/gate 机械校验）：单仓库模式 `baseline.commit` 非空；多仓库模式 `baseline.repos` 非空且每项 `commit` 非空。工作区根与子目录均无 git 仓库时 init 报错，提示先确认工作区结构。
- completion 门：状态 ready_for_review + prd.md 验收标准全部勾选（勾选依据 = review 静态核对）+ review.md「验证记录」覆盖每条已勾选验收标准（格式 `- [x] ACn | 验证方式: ... | 结果: passed | 证据: ...`；结果取值 passed/failed/skipped；无 failed；skipped 必须注明原因）+ review.md「交付确认」标记勾选；存在 subtasks.md 时所有子任务必须勾选完成；`independentReview` 任务额外要求 review.md「独立复核」标记勾选。
- 门禁只机械校验文件与标记，证据真实性由 AI 按纪律判断；Node.js 不可用时按相同规则人工检查，不阻断任务。

## 内部能力（入口 skill 路由调用）

| 能力 | 职责 | 被谁调用 |
| --- | --- | --- |
| winin-sop-spec | 发现并加载开发规范（优先 `.trellis/spec/`，无 Trellis 项目用 `.ai-sop/spec/`，两者同构：按域分目录 + index.md 索引，按风险点命中加载；规范 = 项目实际使用的编码约定，**不含运行时配置**；无规范库则跳过不阻断） | 两入口的建任务阶段；review 合规检查 |
| winin-sop-test | 单元测试环节：以业务链为单位编写真实单测并运行（完整上下文/真实数据/不 mock/回滚隔离），产出验收标准验证证据 | 两入口的实施完成阶段 |
| winin-sop-review | 交付前审查：prd 与实际改动逐条比对 + 影响面分析 + 质量与证据检查 + 规范合规（唯一交付检查）；独立把关执行者 | 两入口的交付阶段 |

## 检索纪律（防历史任务干扰）

1. 默认上下文只碰：规范库（`.trellis/spec/` 或 `.ai-sop/spec/`，按命中）+ `tasks/` 活跃区（按编号）。
2. `archive/` 默认不检索；仅明确历史查询时，先查 `archive/index.md` 摘要，命中才读全文。
3. 归档即隔离：任务归档后立即移出活跃区（归档由用户主动触发）。

## 纪律（不可妥协）

1. 只有主开发代理可以写代码。
2. 不允许通过删除正确检查、降低正确断言、吞异常或跳过必要构建来制造通过结果。
3. 人工确认后若范围或关键方案发生变化，旧确认失效，必须重新确认。
4. 尝试复现失败时禁止根据单一猜测修改业务逻辑；证据不足时进入 observing。
5. 数据库只读查询优先；写操作必须有用户明确指令和权限。
6. 归档仅用户主动触发，AI 不得自行归档。
7. 业务事实（规则/口径/验收标准）禁止假设：只能来自查证、询问或用户豁免；查不到也问不到即 blocked，不允许带着未确认项编码。
8. 创建 git 分支、worktree 等改变仓库/工作区结构的操作：必须先征求用户意见，只提供推荐与理由，不直接执行；以用户决定为准。
