# winin-dev-sop：闻荫开发标准流程

`winin-dev-sop` 是面向软件需求开发和缺陷修复的 AI 协作 Skill。开发人员不需要记忆复杂流程，只需在 Codex、Cursor 或 Claude Code 中打开源码工作区，指定本 Skill 和任务，AI 就会主动完成开工检查、场景判断、方案与测试设计、编码、验证、复核和交付总结。

项目的核心目标很简单：让 AI 使用水平不同的开发人员，使用后都能比原来更快、更稳地把任务推进到可提交测试或代码评审的状态。

## 适用环境

| Agent 工具 | Windows | macOS | 调用方式 |
| --- | --- | --- | --- |
| Codex | 支持 | 支持 | `$winin-dev-sop` |
| Cursor | 支持 | 支持 | `/winin-dev-sop` 或直接点名 |
| Claude Code | 支持 | 支持 | `/winin-dev-sop` 或直接点名 |

Skill 主流程使用通用 Markdown，不依赖特定 Agent 工具、操作系统或大模型。可选的确定性辅助工具采用 Node.js 标准库实现；没有 Node.js 时，AI 会按相同流程降级执行。

## 最快开始方式：让 AI 自动安装

把本仓库地址和下面的提示词一起发给开发人员。开发人员在 Codex、Cursor 或 Claude Code 中粘贴后，AI 会识别当前工具和操作系统，复制 Skill、验证安装并告诉使用者如何开始。

```text
请帮我安装并学习闻荫开发标准流程 Skill。

Skill 仓库地址：https://github.com/jiargcn/winin-dev-sop
Skill 名称：winin-dev-sop

请完成以下工作：
1. 检测当前运行环境是 Codex、Cursor 还是 Claude Code，并识别 Windows 或 macOS。
2. 获取上述仓库，只使用仓库中的 skills/winin-dev-sop 目录作为待安装 Skill。
3. 默认安装到当前用户的全局 Skill 目录：
   - Codex：~/.agents/skills/winin-dev-sop
   - Cursor：~/.cursor/skills/winin-dev-sop
   - Claude Code：~/.claude/skills/winin-dev-sop
   Windows 中将 ~ 解析为当前用户目录，macOS 中使用用户主目录。
4. 如果目标目录已经存在，不要直接覆盖。先比较内容；需要升级时创建同级备份，再复制新版本。
5. 安装后确认目标目录中直接存在 SKILL.md、references、scripts 和 assets，不能多嵌套一层仓库目录。
6. 如果 Node.js 18 或更高版本可用，运行：
   node <安装目录>/scripts/winin-sop.mjs self-test
   如果 Node.js 不可用，说明 Skill 仍可使用，只是确定性辅助检查会由 AI 按文档执行。
7. 验证当前 Agent 能发现 winin-dev-sop；必要时告诉我重新启动客户端或新建会话。
8. 阅读安装目录中的 SKILL.md 和本仓库的“开发人员一页操作卡.md”，用不超过五分钟的内容教会我：如何开始任务、什么时候需要我确认、怎样判断任务真正完成。
9. 最后给出一条适合当前 Agent 的首次使用提示词。

安装过程中不要修改我的业务源码，不要安装无关依赖，不要删除已有 Skill，也不要把密钥、凭据或未脱敏数据发送到外部。
```

也可以直接复制 [AI 安装与自学提示词](AI安装与自学提示词.md)。

## 手工复制安装

不需要运行安装脚本。将本仓库的 `skills/winin-dev-sop` 整个文件夹复制到对应目录：

| 工具 | 项目级目录 | 用户级目录 |
| --- | --- | --- |
| Codex | `<项目>/.agents/skills/winin-dev-sop/` | `~/.agents/skills/winin-dev-sop/` |
| Cursor | `<项目>/.cursor/skills/winin-dev-sop/` | `~/.cursor/skills/winin-dev-sop/` |
| Claude Code | `<项目>/.claude/skills/winin-dev-sop/` | `~/.claude/skills/winin-dev-sop/` |

复制完成后，[Skill 主文件](skills/winin-dev-sop/SKILL.md)必须直接位于目标目录下。

更完整的平台说明和推广前验证矩阵见[安装与试点指南](部署与试点指南.md)。

## 第一次使用

打开需要修改的源码工作区，向 Agent 输入：

```text
使用 winin-dev-sop 完成任务 MES-1234。
任务内容：工单列表增加产线和计划日期组合筛选，原有筛选保持不变。
相关资料：任务单、原型或日志位于……
```

Codex 可把第一句写成：

```text
使用 $winin-dev-sop 完成任务 MES-1234。
```

AI 会自动完成以下过程：

```mermaid
flowchart LR
    A["检查工作区和必要资料"] --> B["选择工作场景"]
    B --> C["分析代码并设计方案与测试"]
    C --> D["必要时请求确认"]
    D --> E["小步编码和逐轮验证"]
    E --> F["检查差异并按风险复核"]
    F --> G["人工确认最终结果"]
    G --> H["输出总结和下一步"]
```

## 开发人员需要做什么

开发人员主要负责两次确认：

1. 编码前确认：新增功能、现有功能修改和复杂缺陷需要确认方案、范围和测试设计。简单展示修改通常不需要。
2. 完成前确认：所有任务都需要确认实际业务结果、最终差异、测试结果和剩余风险。

如果开发过程中出现公共对象、公共接口、数据库变化、MOM 核心状态变化或明显扩大范围，AI 会暂停并增加一次范围确认。

日常使用只需阅读[开发人员一页操作卡](开发人员一页操作卡.md)，不需要通读整个 Skill。

## 怎样判断任务真正完成

只有 AI 给出 `ready_for_review`，并同时展示以下内容，才具备提交测试或代码评审的条件：

- 实际修改了什么；
- 每条验收标准如何验证；
- 执行了哪些测试和构建，结果是什么；
- 哪些项目没有执行以及原因；
- 是否存在剩余风险；
- 开发人员是否完成最终确认；
- 下一步应该做什么。

“代码已经生成”“看起来正确”或“AI 已自查”都不表示任务完成。

## 第一版包含什么

- 四个直观场景：新增功能、修改现有功能、简单修改、缺陷处理。
- 按条件增加数据库、公共对象、MOM、安全、性能和生产偶发检查。
- 大任务最多拆成一层同级子任务，每次只实施一个。
- 中高风险任务使用独立只读复核；平台不支持子代理时降级为独立会话或人工评审。
- 每个任务使用 `.ai-sop/tasks/<task-id>/` 独立目录，避免不同需求和缺陷串档。
- 跨平台任务初始化、门禁和完成总结工具。

## 仓库结构

```text
skills/winin-dev-sop/
├─ SKILL.md
├─ agents/
│  └─ openai.yaml
├─ assets/
│  └─ task-state.template.json
├─ references/
│  ├─ readiness.md
│  ├─ scenario-new-feature.md
│  ├─ scenario-existing-change.md
│  ├─ scenario-simple-change.md
│  ├─ scenario-bug.md
│  ├─ risk-actions.md
│  └─ review-protocol.md
└─ scripts/
   └─ winin-sop.mjs
```

仓库只发布当前有效版本。历史试点资料不进入公开仓库，避免开发人员误用过期流程。
