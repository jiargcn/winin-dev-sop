#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCENARIOS = ["new-feature", "existing-change", "simple-change", "bug"];
const AI_APPROVER_NAMES = new Set([
  "ai", "agent", "assistant", "model", "gpt", "claude", "copilot", "cursor", "codex",
  "llm", "bot", "self", "winin-dev-sop", "代理", "模型", "助手",
]);
const WEAK_PHRASES = new Set([
  "", "ok", "okay", "yes", "y", "好", "好的", "可以", "行", "嗯", "嗯嗯", "lgtm", "pass", "通过",
]);
const PLAN_SHOWN_KEYS = ["goal", "plan", "testDesign", "scope"];
const REVIEW_SHOWN_KEYS = ["goal", "diff", "acceptanceResults", "tests", "skipped", "remainingRisks"];
const MAX_DIFF_CHARS = 4000;

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

function planApprovalNeeded(state) {
  return state.scenario !== "simple-change";
}

function isAiApprover(name) {
  const value = String(name || "").trim().toLowerCase();
  if (!value) return true;
  return AI_APPROVER_NAMES.has(value);
}

function isWeakPhrase(phrase) {
  return WEAK_PHRASES.has(String(phrase || "").trim().toLowerCase());
}

function hasShown(obj, keys) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  return keys.every((key) => String(obj[key] || "").trim().length > 0);
}

function validHumanPhrase(phrase, expectedToken) {
  if (isWeakPhrase(phrase)) return false;
  const text = String(phrase || "").trim();
  if (text.includes(expectedToken)) return true;
  return text.length >= 12;
}

function validateHumanConfirmation(kind, approvedBy, approvedAt, phrase, shown, shownKeys, expectedToken, errors) {
  const label = kind === "plan" ? "方案确认" : "合并前确认";
  if (isAiApprover(approvedBy)) errors.push(`${label}的确认人必须是开发人员，不能是 AI 或空值（当前：${approvedBy || "未填写"}）`);
  if (!String(approvedAt || "").trim()) errors.push(`${label}缺少 approvedAt`);
  if (!validHumanPhrase(phrase, expectedToken)) {
    errors.push(`${label}需要开发人员在当前对话中明确回复「${expectedToken}」，或复述已展示内容后的明确同意；仅回复 ok / 好的 / 可以 无效`);
  }
  if (!hasShown(shown, shownKeys)) errors.push(`${label}缺少已向开发人员展示的内容记录（${shownKeys.join("、")}）`);
}

function findGitRepo(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 12; i += 1) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "";
}

function recordedFileLines(state) {
  const files = state.changes && Array.isArray(state.changes.files) ? state.changes.files : [];
  return files.map((item) => {
    if (typeof item === "string") return item.trim();
    if (!item || typeof item !== "object") return "";
    const kind = String(item.kind || item.status || "M").trim();
    const filePath = String(item.path || item.file || "").trim();
    return filePath ? `${kind} ${filePath}` : "";
  }).filter(Boolean);
}

function parseNameStatus(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function collectChangeEvidence(taskDir, state) {
  const recorded = recordedFileLines(state);
  const repo = findGitRepo(taskDir);
  const commit = state.baseline && state.baseline.commit;
  const usableCommit = commit && commit !== "NO_GIT_BASELINE" ? commit : "";
  if (!repo || !usableCommit) {
    return {
      source: recorded.length ? "recorded" : "none",
      files: recorded,
      stat: state.changes && state.changes.note ? String(state.changes.note) : "",
      excerpt: "",
    };
  }

  const nameStatus = parseNameStatus(runGit(repo, ["diff", "--name-status", usableCommit]));
  const cached = parseNameStatus(runGit(repo, ["diff", "--name-status", "--cached", usableCommit]));
  const vsHead = parseNameStatus(runGit(repo, ["diff", "--name-status", `${usableCommit}...HEAD`]));
  const porcelain = parseNameStatus(runGit(repo, ["status", "--porcelain"]));
  const files = [...new Set([...nameStatus, ...cached, ...vsHead, ...porcelain])];
  const stat = runGit(repo, ["diff", "--stat", usableCommit]) || runGit(repo, ["diff", "--stat", `${usableCommit}...HEAD`]);
  let excerpt = runGit(repo, ["diff", usableCommit]) || runGit(repo, ["diff", `${usableCommit}...HEAD`]);
  if (excerpt.length > MAX_DIFF_CHARS) {
    excerpt = `${excerpt.slice(0, MAX_DIFF_CHARS)}\n…差异过长，已截断。完整内容请在仓库执行：git diff ${usableCommit}`;
  }
  if (files.length) {
    return { source: "git", files, stat, excerpt, commit: usableCommit, repo };
  }
  return {
    source: recorded.length ? "recorded" : "none",
    files: recorded,
    stat: state.changes && state.changes.note ? String(state.changes.note) : "",
    excerpt: "",
    commit: usableCommit,
    repo,
  };
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
  else if (!SCENARIOS.includes(state.scenario)) errors.push(`未知工作场景：${state.scenario}`);
  if (!Array.isArray(state.inputs.missing)) errors.push("inputs.missing 格式错误");
  else if (state.inputs.missing.length > 0) errors.push(`仍缺少必要资料：${state.inputs.missing.join("；")}`);

  if (name === "readiness") return errors;

  requireFile(taskDir, state.plan.path, errors, "开发方案");
  requireFile(taskDir, state.tests.designPath, errors, "测试设计");
  if (planApprovalNeeded(state)) {
    if (!state.plan.approved) errors.push("开发方案和测试设计尚未获得人工确认");
    else validateHumanConfirmation("plan", state.plan.approvedBy, state.plan.approvedAt, state.plan.confirmationPhrase, state.plan.shownToHuman, PLAN_SHOWN_KEYS, "确认方案", errors);
  }

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
  else {
    validateHumanConfirmation("review", state.review.approvedBy, state.review.approvedAt, state.review.confirmationPhrase, state.review.shownToHuman, REVIEW_SHOWN_KEYS, "确认结果", errors);
  }
  const evidence = collectChangeEvidence(taskDir, state);
  if (!evidence.files.length) errors.push("没有文件级变更证据：请提供相对 baseline.commit 的 git diff，或在 changes.files 中记录修改文件");
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

function list(items) {
  if (!items.length) return "- 无";
  return items.map((item) => `- ${typeof item === "string" ? item : `${item.command}：${item.result}${item.note ? `（${item.note}）` : ""}`}`).join("\n");
}

function formatChangeSection(evidence) {
  const source = evidence.source === "git"
    ? `git diff 相对 ${evidence.commit}`
    : evidence.source === "recorded"
      ? "任务记录的文件清单（无可用 git diff）"
      : "无";
  const files = evidence.files.length ? evidence.files.map((item) => `- ${item}`).join("\n") : "- 无";
  const stat = evidence.stat ? `\n\n${evidence.stat}` : "";
  const excerpt = evidence.excerpt ? `\n\n\`\`\`diff\n${evidence.excerpt}\n\`\`\`` : "";
  return `证据来源：${source}\n\n${files}${stat}${excerpt}`;
}

function summary(taskDir) {
  const errors = gate(taskDir, "completion");
  if (errors.length) throw new Error(`完成门禁未通过：\n- ${errors.join("\n- ")}`);
  const state = readJson(path.join(taskDir, "task-state.json"));
  const evidence = collectChangeEvidence(taskDir, state);
  const planLine = planApprovalNeeded(state)
    ? `已完成（确认人：${state.plan.approvedBy}，用语：${state.plan.confirmationPhrase}）`
    : "不要求（简单修改）";
  const independentLine = state.review.independentRequired
    ? (state.review.independentCompleted ? "已完成" : "未完成")
    : "不要求";
  const report = `# 闻荫开发标准流程完成记录

## 任务

- 编号：${state.taskId}
- 标题：${state.title}
- 场景：${state.scenario}
- 基线：${state.baseline.commit}
- 状态：${state.status}

## 目标

${state.goal}

## 验收标准

${list(state.acceptanceCriteria)}

## 实际修改

${formatChangeSection(evidence)}

## 测试与验证

${list(state.tests.executions)}

## 剩余风险

${list(state.remainingRisks)}

## 人工确认

- 方案确认：${planLine}
- 独立复核：${independentLine}
- 合并前确认：已完成
  - 确认人：${state.review.approvedBy}
  - 确认用语：${state.review.confirmationPhrase}
  - 确认时间：${state.review.approvedAt}
  - 已展示：目标、文件级差异、验收结果、测试、未执行项、剩余风险

## 下一步

${state.nextAction}
`;
  const output = path.join(taskDir, "completion-report.md");
  fs.writeFileSync(output, report, "utf8");
  process.stdout.write(`${output}\n`);
}

function silent(fn) {
  const original = process.stdout.write;
  process.stdout.write = () => true;
  try {
    return fn();
  } finally {
    process.stdout.write = original;
  }
}

function gitInitRepo(repo) {
  const run = (args) => {
    const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")} 失败：${result.stderr || result.stdout}`);
  };
  const initialized = spawnSync("git", ["init", "-b", "main", repo], { encoding: "utf8" });
  if (initialized.status !== 0) {
    const fallback = spawnSync("git", ["init", repo], { encoding: "utf8" });
    if (fallback.status !== 0) throw new Error(`git init 失败：${fallback.stderr || initialized.stderr}`);
  }
  run(["config", "user.email", "self-test@example.com"]);
  run(["config", "user.name", "winin-self-test"]);
  run(["config", "commit.gpgsign", "false"]);
  fs.writeFileSync(path.join(repo, "README.md"), "baseline\n", "utf8");
  run(["add", "README.md"]);
  run(["commit", "-m", "baseline"]);
}

function fillReviewEvidence(state, overrides = {}) {
  state.review.humanApproved = true;
  state.review.approvedBy = overrides.approvedBy ?? "开发人员";
  state.review.approvedAt = overrides.approvedAt ?? new Date().toISOString();
  state.review.confirmationPhrase = overrides.confirmationPhrase ?? "确认结果";
  state.review.shownToHuman = overrides.shownToHuman ?? {
    goal: "验证初始化、门禁和总结",
    diff: "README.md 增加一行自检标记",
    acceptanceResults: "完成报告能够生成",
    tests: "node winin-sop.mjs self-test：passed",
    skipped: "无未执行项",
    remainingRisks: "无",
  };
}

function selfTest() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "winin-dev-sop-"));
  try {
    gitInitRepo(repo);
    silent(() => init({ repo, task: "TEST-1", title: "跨平台自检" }));
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
    writeJson(statePath, state);
    const implementationErrors = gate(taskDir, "implementation");
    if (implementationErrors.length) throw new Error(`简单修改在方案未批准时应能通过实施门禁：${implementationErrors.join("；")}`);
    if (state.plan.approved) throw new Error("简单修改自检不应把 plan.approved 设为 true");
    if (!state.plan.approvalRequired) throw new Error("自检应保留 init 默认的 approvalRequired，以证明门禁按场景判断");

    state.scenario = "existing-change";
    writeJson(statePath, state);
    if (!gate(taskDir, "implementation").some((item) => item.includes("人工确认"))) {
      throw new Error("非简单修改在方案未批准时不应通过实施门禁");
    }

    state.scenario = "simple-change";
    state.tests.executions = [{ command: "node winin-sop.mjs self-test", result: "failed", note: "用于验证失败门禁" }];
    fillReviewEvidence(state);
    state.status = "ready_for_review";
    state.nextAction = "结束自检";
    writeJson(statePath, state);
    const failedTestErrors = gate(taskDir, "completion");
    if (!failedTestErrors.some((item) => item.includes("失败"))) throw new Error("失败测试未阻止完成门禁");

    state.tests.executions = [{ command: "node winin-sop.mjs self-test", result: "passed", note: "临时目录验证" }];
    state.review.humanApproved = false;
    state.review.approvedBy = "";
    state.review.approvedAt = "";
    state.review.confirmationPhrase = "";
    state.review.shownToHuman = { goal: "", diff: "", acceptanceResults: "", tests: "", skipped: "", remainingRisks: "" };
    writeJson(statePath, state);
    if (!gate(taskDir, "completion").some((item) => item.includes("合并前人工确认"))) {
      throw new Error("缺少 humanApproved 时完成门禁应失败");
    }

    fillReviewEvidence(state, { confirmationPhrase: "", shownToHuman: { goal: "", diff: "", acceptanceResults: "", tests: "", skipped: "", remainingRisks: "" } });
    writeJson(statePath, state);
    const missingEvidence = gate(taskDir, "completion");
    if (!missingEvidence.some((item) => item.includes("展示") || item.includes("确认结果") || item.includes("ok"))) {
      throw new Error(`humanApproved 为 true 但缺少确认证据时应失败：${missingEvidence.join("；")}`);
    }

    fillReviewEvidence(state, { confirmationPhrase: "ok" });
    writeJson(statePath, state);
    if (!gate(taskDir, "completion").some((item) => item.includes("确认结果") || item.includes("ok"))) {
      throw new Error("仅回复 ok 不应视为有效最终确认");
    }

    fillReviewEvidence(state, { approvedBy: "ai" });
    writeJson(statePath, state);
    if (!gate(taskDir, "completion").some((item) => item.includes("开发人员"))) {
      throw new Error("确认人为 ai 时完成门禁应失败");
    }

    fillReviewEvidence(state);
    fs.appendFileSync(path.join(repo, "README.md"), "self-test change\n", "utf8");
    writeJson(statePath, state);
    for (const name of ["readiness", "implementation", "completion"]) {
      const errors = gate(taskDir, name);
      if (errors.length) throw new Error(`${name}：${errors.join("；")}`);
    }
    silent(() => summary(taskDir));
    const reportPath = path.join(taskDir, "completion-report.md");
    if (!fs.existsSync(reportPath)) throw new Error("完成报告未生成");
    const report = fs.readFileSync(reportPath, "utf8");
    if (!report.includes("结束自检")) throw new Error("完成报告未包含下一步动作");
    if (!report.includes("README.md") && !report.includes("实际修改")) throw new Error("完成报告未包含文件级变更证据");
    if (!report.includes("git diff") && !report.includes("文件清单")) throw new Error("完成报告未说明变更证据来源");

    const nogit = fs.mkdtempSync(path.join(os.tmpdir(), "winin-dev-sop-nogit-"));
    try {
      silent(() => init({ repo: nogit, task: "TEST-2", title: "无 Git 自检" }));
      const taskDir2 = path.join(nogit, ".ai-sop", "tasks", "TEST-2");
      const state2 = readJson(path.join(taskDir2, "task-state.json"));
      state2.scenario = "simple-change";
      state2.goal = "无 Git 时仍能记录变更";
      state2.acceptanceCriteria = ["完成报告包含文件清单"];
      state2.tests.executions = [{ command: "visual check", result: "passed", note: "无 Git" }];
      state2.changes = { files: [{ path: "app/label.txt", kind: "modified" }], note: "仅文案" };
      fillReviewEvidence(state2);
      state2.status = "ready_for_review";
      state2.nextAction = "无 Git 下一步";
      writeJson(path.join(taskDir2, "task-state.json"), state2);
      const noGitErrors = gate(taskDir2, "completion");
      if (noGitErrors.length) throw new Error(`无 Git 完成门禁应通过：${noGitErrors.join("；")}`);
      silent(() => summary(taskDir2));
      const report2 = fs.readFileSync(path.join(taskDir2, "completion-report.md"), "utf8");
      if (!report2.includes("app/label.txt")) throw new Error("无 Git 完成报告应包含记录的文件清单");
      if (!report2.includes("无 Git 下一步")) throw new Error("无 Git 完成报告应包含下一步");
    } finally {
      fs.rmSync(nogit, { recursive: true, force: true });
    }

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
  else if (command === "skill-dir") process.stdout.write(`${SKILL_DIR}\n`);
  else if (command === "self-test") selfTest();
  else fail("用法：winin-sop.mjs <init|gate|summary|skill-dir|self-test> [参数]");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
