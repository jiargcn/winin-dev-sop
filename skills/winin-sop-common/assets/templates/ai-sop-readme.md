# .ai-sop 工作区

闻荫开发标准流程（winin-sop）的任务与规范目录，位于**工作区根**。

| 目录 | 用途 |
| --- | --- |
| `spec/` | 团队规范（仅项目无 `.trellis/spec/` 时使用；结构对齐 Trellis：按域分目录，每域一个 index.md，根级 index.md 非必须） |
| `tasks/` | 活跃任务区（任务 init 时自动建目录，按编号检索） |
| `archive/` | 已归档任务（归档时自动创建，默认不检索） |

## 常用命令

```text
# 环境初始化（迁移 skill 包后、首次使用前执行；幂等，不覆盖已有文件）
node <skills根>/winin-sop-common/scripts/winin-sop.mjs init-env --repo <工作区根>

# 任务命令
node <skills根>/winin-sop-common/scripts/winin-sop.mjs init|status|gate|archive|list ...
```

## 规范放哪

1. 项目有 Trellis（`.trellis/spec/` 存在）→ 规范放那里，本目录 spec/ 保持空。
2. 无 Trellis → 规范放 `spec/`，结构对齐 .trellis/spec：按域分目录（backend/ frontend/ guides/），每域一个 index.md；**根级 index.md 不是必须**。
3. 从 Trellis 整体迁移：直接把 `.trellis/spec/` 内容拷到 `spec/` 即可，init-env 检测到已有规范不会创建任何模板。
