# 技术栈与工具附录

本目录把通用流程映射到公司的当前技术栈。项目仓库已经定义了更严格或不同的命令时，以项目说明和流水线为准，但不得降低测试、数据安全和人工评审门禁。

| 附录 | 用途 |
| --- | --- |
| [Java、Vue 与构建验证](Java-Vue与构建验证.md) | Java 17、Spring Boot 3、Maven、Vue 3、Vitest 的基础命令和检查顺序 |
| [Understand Anything 使用规则](Understand-Anything使用规则.md) | 全量图谱、增量更新与定向分析的选择和证据要求 |
| [PostgreSQL 变更检查](PostgreSQL变更检查.md) | 最新 DDL、SQL、迁移、锁、回退和对账检查 |
| [GitHub 协作与质量门禁](GitHub协作与质量门禁.md) | 分支、差异审查、Pull Request 和 Actions 的个人开发交付要求 |
| [MOM 领域检查清单](MOM领域检查清单.md) | MES、WMS、QMS、EAM 等业务事实与闭环检查 |

命令示例不包含项目路径、凭据和环境地址。执行任何可能修改数据库、生产配置或外部系统状态的命令前，必须遵循项目授权和发布流程。
