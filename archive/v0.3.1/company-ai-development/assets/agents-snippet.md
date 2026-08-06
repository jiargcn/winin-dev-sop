<!-- company-ai-development:start -->
## 公司 AI 协作开发 SOP

凡是要求实现需求、修改功能、修复或排查缺陷、重构、升级依赖、调整构建配置或建立新项目切片的任务，都必须使用 `$company-ai-development` Skill 接管流程。先读取 `.ai-sop/project-profile.json` 并建立 `.ai-sop/task-state.json`，通过路由和实施门禁后才能修改代码。

解释、只读代码问答和不要求变更的评审不启动该流程。整个任务只允许一个代码写入代理；Sidecar 只能使用独立只读上下文，并且报告必须通过检查包哈希验证。
<!-- company-ai-development:end -->
