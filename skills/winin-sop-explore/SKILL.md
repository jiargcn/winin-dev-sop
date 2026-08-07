---
name: winin-sop-explore
description: 探索代码回答问题。理解架构、定位实现、追溯调用链和数据流、回答"X 怎么实现的""这个接口谁在调"。只读，不建任务，不修改代码。
---

# 探索代码回答问题

## 适用场景

- "X 功能是怎么实现的 / 这个接口谁在调 / 这条数据流怎么走的"
- 开发前的代码调研（feature/bugfix 内部也会调用本 skill 的定位方法）

## 执行步骤

### 1. 定位入口

从用户给的业务术语、页面路径、接口路径出发：
1. 前端：`ui/src/views/**` 页面 → `ui/src/api/**` 接口定义
2. 后端：Controller 路径 → Service → Mapper
3. 用 `rg` 按业务术语（中文名、字段名、类名）定向搜索，不全文扫描

### 2. 追溯调用链

```
Controller（入口、参数校验）
  → Service（业务规则、事务边界）
    → Mapper/SQL（数据访问）
    → 外部调用（RPC、MQ、HTTP）
```

每层回答三个问题：谁调用它、它调用谁、数据怎么流转。

### 3. 提取关键事实

- 业务规则与状态流转（从代码注释、枚举、if 分支提取）
- 数据表与关键字段
- 权限控制点
- 事务与并发特征

### 4. 结构化回答

按以下格式输出，每条结论附代码位置证据：

```text
## 入口
页面: ui/src/views/.../index.vue → api: /wms/xxx/page

## 调用链
XxxController.page() → XxxService.page() → XxxMapper.selectPage()
（XxxService.java:120 有数据权限过滤）

## 关键规则
1. 状态流转: 1(新建) → submit → 2(已提交) → agree → 3(处理中)（XxxService.java:88）
2. 事务边界: @Transactional 覆盖 create+update（XxxService.java:45）

## 涉及数据
表 xxx_main / xxx_detail；关键字段 status, number

## 相关规范
（如已加载 winin-sop-spec，引用规范要点）
```

## 纪律

- 只读：不修改任何文件。
- 结论必须有代码位置证据（文件:行号），不确定的标注"待确认"。
- 回答只覆盖问题所需范围，不做全量分析。
- 如果用户后续要修改，提示走 winin-sop-bugfix / winin-sop-feature 入口建任务。
