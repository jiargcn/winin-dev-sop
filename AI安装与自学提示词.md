# winin-dev-sop AI 安装与自学提示词

将下面整段内容复制到 Codex、Cursor 或 Claude Code，并把仓库地址替换成实际地址。

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

## 安装后首次任务提示词

```text
使用 winin-dev-sop 完成任务 <任务编号>。

任务内容：<粘贴需求或缺陷描述>。
验收标准：<如任务单已经提供则粘贴；没有则让 AI 协助整理>。
相关资料：<任务单、原型、截图、日志或参考实现的位置>。

请先检查当前工作区和必要资料是否满足开工条件。缺少必要信息时一次性告诉我需要补充什么；满足条件后按 Skill 推进，并在需要人工确认的节点明确展示确认内容、风险和下一步动作。
```

Codex 用户可以把第一句替换为：

```text
使用 $winin-dev-sop 完成任务 <任务编号>。
```

## 安装后自学提示词

```text
请使用 winin-dev-sop 的教学方式带我完成一次不修改业务代码的演练。

先阅读 Skill 和“开发人员一页操作卡.md”，然后：
1. 用一个简单需求演示开工检查和自动选路；
2. 演示 AI 会怎样整理方案和测试设计；
3. 明确指出哪两次主要确认需要由开发人员完成；
4. 展示一份合格的最终完成总结；
5. 最后让我用自己的任务描述重新练习一次。

控制讲解长度，只讲开发人员实际需要操作的内容，不要求我记忆场景编号、内部状态字段或脚本命令。
```
