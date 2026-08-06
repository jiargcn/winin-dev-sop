#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) {
      result._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      i += 1;
    }
  }
  return result;
}

function runGit(repo, args) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveTaskDir(value) {
  if (!value) throw new Error("缺少 --task-dir");
  return path.resolve(value);
}

function requireFile(taskDir, relativePath, errors, label) {
  if (!relativePath || !fs.existsSync(path.resolve(taskDir, relativePath))) {
    errors.push(`${label}不存在：${relativePath || "未填写"}`);
  }
}

function validateStateShape(state) {
  const required = ["schemaVersion", "taskId", "title", "baseline", "scenario", "riskSignals", "goal", "acceptanceCriteria", "inputs", "plan", "tests", "review", "remainingRisks", "status", "nextAction"];
  return required.filter((key) => !(key in state)).map((key) => `task-state.json 缺少字段：${key}`);
}

function gate(taskDir, name) {
  const statePath = path.join(taskDir, "task-state.json");
  if (!fs.existsSync(statePath)) return ["task-state.json 不存在"];
  const state = readJson(statePath);
  const errors = validateStateShape(state);
  if (errors.length) return errors;

  if (!state.goal.trim()) errors.push("任务目标未填写");
  if (!Array.isArray(state.acceptanceCriteria) || state.acceptanceCriteria.length === 0) errors.push("验收标准未填写");
  if (!state.baseline.commit) errors.push("基线提交未记录；非 Git 项目请写 NO_GIT_BASELINE");
  if (state.scenario === "unclassified") errors.push("工作场景尚未确定");
  if (!Array.isArray(state.inputs.missing)) errors.push("inputs.missing 格式错误");
  else if (state.inputs.missing.length > 0) errors.push(`仍缺少必要资料：${state.inputs.missing.join("；")}`);

  if (name === "readiness") return errors;

  requireFile(taskDir, state.plan.path, errors, "开发方案");
  requireFile(taskDir, state.tests.designPath, errors, "测试设计");
  if (state.plan.approvalRequired && !state.plan.approved) errors.push("开发方案和测试设计尚未获得人工确认");

  if (name === "implementation") return errors;
  if (name !== "completion") return [`未知门禁：${name}`];

  if (!Array.isArray(state.tests.executions) || state.tests.executions.length === 0) errors.push("没有测试或可重复验证执行记录");
  else {
    if (state.tests.executions.some((item) => !item || !item.command || !item.result)) errors.push("测试记录必须包含 command 和 result");
    if (state.tests.executions.some((item) => item && item.result === "failed")) errors.push("仍存在失败的测试或验证记录");
    if (state.tests.executions.some((item) => item && item.result === "not_run" && !item.note)) errors.push("未执行项必须说明原因");
    if (!state.tests.executions.some((item) => item && item.result === "passed")) errors.push("没有通过的测试或可重复验证记录");
  }
  requireFile(taskDir, state.review.path, errors, "最终复核记录");
  if (state.review.independentRequired && !state.review.independentCompleted) errors.push("需要独立复核，但尚未完成");
  if (!state.review.humanApproved) errors.push("合并前人工确认尚未完成");
  if (state.status !== "ready_for_review") errors.push("任务状态不是 ready_for_review");
  if (!state.nextAction.trim()) errors.push("下一步动作未填写");
  return errors;
}

function init(args) {
  const repo = path.resolve(String(args.repo || "."));
  const taskId = String(args.task || "");
  const title = String(args.title || "");
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) throw new Error(`源码目录不存在：${repo}`);
  if (!/^[A-Za-z0-9._-]+$/.test(taskId)) throw new Error("--task 只能包含字母、数字、点、下划线和连字符");
  if (!title.trim()) throw new Error("缺少 --title");

  const taskDir = path.join(repo, ".ai-sop", "tasks", taskId);
  if (fs.existsSync(taskDir)) throw new Error(`任务目录已存在，不会覆盖：${taskDir}`);
  fs.mkdirSync(taskDir, { recursive: true });

  const branch = runGit(repo, ["branch", "--show-current"]) || "NO_GIT_BRANCH";
  const commit = runGit(repo, ["rev-parse", "HEAD"]) || "NO_GIT_BASELINE";
  const dirty = Boolean(runGit(repo, ["status", "--porcelain"]));
  const now = new Date().toISOString();
  const state = readJson(new URL("../assets/task-state.template.json", import.meta.url));
  state.taskId = taskId;
  state.title = title;
  state.baseline = { branch, commit, workingTreeInitiallyDirty: dirty };
  state.createdAt = now;
  state.updatedAt = now;
  writeJson(path.join(taskDir, "task-state.json"), state);
  fs.writeFileSync(path.join(taskDir, "plan.md"), "# 开发方案\n\n## 目标与范围\n\n## 现状证据\n\n## 修改方案\n\n## 回退方法\n", "utf8");
  fs.writeFileSync(path.join(taskDir, "test-design.md"), "# 测试设计\n\n## 验收标准映射\n\n## 回归范围\n", "utf8");
  fs.writeFileSync(path.join(taskDir, "review.md"), "# 最终复核\n\n## 差异检查\n\n## 验收标准结果\n\n## 未执行项与剩余风险\n", "utf8");
  process.stdout.write(`${JSON.stringify({ taskDir, statePath: path.join(taskDir, "task-state.json") }, null, 2)}\n`);
}

function summary(taskDir) {
  const errors = gate(taskDir, "completion");
  if (errors.length) throw new Error(`完成门禁未通过：\n- ${errors.join("\n- ")}`);
  const state = readJson(path.join(taskDir, "task-state.json"));
  const list = (items) => items.length ? items.map((item) => `- ${typeof item === "string" ? item : `${item.command}：${item.result}${item.note ? `（${item.note}）` : ""}`}`).join("\n") : "- 无";
  const report = `# 闻荫开发标准流程完成记录\n\n## 任务\n\n- 编号：${state.taskId}\n- 标题：${state.title}\n- 场景：${state.scenario}\n- 基线：${state.baseline.commit}\n- 状态：${state.status}\n\n## 目标\n\n${state.goal}\n\n## 验收标准\n\n${list(state.acceptanceCriteria)}\n\n## 测试与验证\n\n${list(state.tests.executions)}\n\n## 剩余风险\n\n${list(state.remainingRisks)}\n\n## 人工确认\n\n- 方案确认：${state.plan.approved ? "已完成" : "不要求"}\n- 独立复核：${state.review.independentRequired ? (state.review.independentCompleted ? "已完成" : "未完成") : "不要求"}\n- 合并前确认：已完成\n\n## 下一步\n\n${state.nextAction}\n`;
  const output = path.join(taskDir, "completion-report.md");
  fs.writeFileSync(output, report, "utf8");
  process.stdout.write(`${output}\n`);
}

function selfTest() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "winin-dev-sop-"));
  try {
    const original = process.stdout.write;
    process.stdout.write = () => true;
    init({ repo, task: "TEST-1", title: "跨平台自检" });
    process.stdout.write = original;
    const taskDir = path.join(repo, ".ai-sop", "tasks", "TEST-1");
    const statePath = path.join(taskDir, "task-state.json");
    if (gate(taskDir, "readiness").length === 0) throw new Error("空任务不应通过开工门禁");
    let overwriteBlocked = false;
    try {
      init({ repo, task: "TEST-1", title: "不应覆盖" });
    } catch {
      overwriteBlocked = true;
    }
    if (!overwriteBlocked) throw new Error("已有任务目录未阻止覆盖");
    const state = readJson(statePath);
    state.scenario = "simple-change";
    state.goal = "验证初始化、门禁和总结";
    state.acceptanceCriteria = ["完成报告能够生成"];
    state.plan.approvalRequired = false;
    state.tests.executions = [{ command: "node winin-sop.mjs self-test", result: "failed", note: "用于验证失败门禁" }];
    state.review.humanApproved = true;
    state.review.approvedBy = "self-test";
    state.review.approvedAt = new Date().toISOString();
    state.status = "ready_for_review";
    state.nextAction = "结束自检";
    writeJson(statePath, state);
    if (!gate(taskDir, "completion").some((item) => item.includes("失败"))) throw new Error("失败测试未阻止完成门禁");
    state.tests.executions = [{ command: "node winin-sop.mjs self-test", result: "passed", note: "临时目录验证" }];
    writeJson(statePath, state);
    for (const name of ["readiness", "implementation", "completion"]) {
      const errors = gate(taskDir, name);
      if (errors.length) throw new Error(`${name}：${errors.join("；")}`);
    }
    const originalSummaryWrite = process.stdout.write;
    process.stdout.write = () => true;
    summary(taskDir);
    process.stdout.write = originalSummaryWrite;
    const reportPath = path.join(taskDir, "completion-report.md");
    if (!fs.existsSync(reportPath)) throw new Error("完成报告未生成");
    if (!fs.readFileSync(reportPath, "utf8").includes("结束自检")) throw new Error("完成报告未包含下一步动作");
    process.stdout.write("winin-dev-sop self-test passed\n");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
try {
  if (command === "init") init(args);
  else if (command === "gate") {
    const errors = gate(resolveTaskDir(args["task-dir"]), String(args.name || ""));
    if (errors.length) fail(`门禁未通过：\n- ${errors.join("\n- ")}`);
    else process.stdout.write(`${args.name} gate passed\n`);
  }
  else if (command === "summary") summary(resolveTaskDir(args["task-dir"]));
  else if (command === "self-test") selfTest();
  else fail("用法：winin-sop.mjs <init|gate|summary|self-test> [参数]");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
