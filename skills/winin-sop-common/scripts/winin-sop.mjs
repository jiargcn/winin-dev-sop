#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

function taskDirOf(repo, taskId) {
  return path.join(repo, ".ai-sop", "tasks", taskId);
}

function readState(taskDir) {
  return readJson(path.join(taskDir, "task-state.json"));
}

function writeState(taskDir, state) {
  writeJson(path.join(taskDir, "task-state.json"), state);
}

function requireFile(taskDir, relativePath, errors, label) {
  if (!relativePath || !fs.existsSync(path.resolve(taskDir, relativePath))) {
    errors.push(`${label}不存在：${relativePath || "未填写"}`);
  }
}

const VALID_STATUS = ["planning", "in_progress", "ready_for_review", "blocked", "observing", "completed"];
// 定位层字段：状态/档位/基线。验收标准、复核证据分别在 prd.md / review.md，
// 是唯一真相，不重复写入 JSON。
const REQUIRED_FIELDS = ["taskId", "title", "status", "complexity", "independentReview", "baseline", "createdAt"];

function validateStateShape(state) {
  return REQUIRED_FIELDS.filter((key) => !(key in state))
    .map((key) => `task-state.json 缺少字段：${key}`);
}

function readFileIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

// 取某个 "## 小节" 的内容行（不含标题与后续小节）
function sectionLines(content, header) {
  const out = [];
  let active = false;
  for (const line of content.split(/\r?\n/)) {
    const m = /^##\s+(.+)$/.exec(line);
    if (m) {
      if (m[1].trim() === header) {
        active = true;
        continue;
      }
      if (active) break;
    } else if (active) out.push(line);
  }
  return out.map((l) => l.trim()).filter(Boolean);
}

function hasMarker(file, marker) {
  return readFileIfExists(file).split(/\r?\n/).some((l) => l.includes(marker));
}

// prd.md 验收标准小节：勾选/未勾选的 AC 编号（如 AC1/AC2；无编号的行不计入）
function acceptanceCriteria(taskDir) {
  const lines = sectionLines(readFileIfExists(path.join(taskDir, "prd.md")), "验收标准");
  const checked = [];
  const unchecked = [];
  for (const line of lines) {
    const m = /^-\s*\[([ xX])\]\s*(AC\d+)/i.exec(line);
    if (!m) continue;
    (/\s*[xX]\s*/.test(m[1]) ? checked : unchecked).push(m[2].toUpperCase());
  }
  return { checked, unchecked };
}

// review.md「验证记录」小节：- [x] AC1 | 验证方式: ... | 结果: passed | 证据: ...
// 解析出 { ac, checked, result, hasReason }[]；非 AC 编号行忽略
function verificationRecords(taskDir) {
  const lines = sectionLines(readFileIfExists(path.join(taskDir, "review.md")), "验证记录");
  const out = [];
  for (const line of lines) {
    const m = /^-\s*\[([ xX])\]\s*(AC\d+)\s*(.*)$/i.exec(line);
    if (!m) continue;
    const res = /结果[:：]\s*([A-Za-z_]+)/.exec(m[3]);
    out.push({
      ac: m[2].toUpperCase(),
      checked: /\s*[xX]\s*/.test(m[1]),
      result: res ? res[1].toLowerCase() : "",
      hasReason: /原因/.test(m[3]),
    });
  }
  return out;
}

// subtasks.md 未勾选的子任务编号（ST1/ST2...）
function openSubtasks(taskDir) {
  if (!fs.existsSync(path.join(taskDir, "subtasks.md"))) return [];
  return readFileIfExists(path.join(taskDir, "subtasks.md")).split(/\r?\n/)
    .filter((l) => /^-\s*\[\s*\]\s*ST\d+/i.test(l))
    .map((l) => (l.match(/ST\d+/i) || [""])[0].toUpperCase());
}

// 机械门禁：只校验文件与标记；证据真实性由 AI 按纪律判断
// expectedStatus：状态机绑定时传入目标状态（status 命令在切换前校验）
function gate(taskDir, name, expectedStatus) {
  const statePath = path.join(taskDir, "task-state.json");
  if (!fs.existsSync(statePath)) return ["task-state.json 不存在"];
  const state = readState(taskDir);
  const errors = validateStateShape(state);
  if (errors.length) return errors;

  if (!state.title.trim()) errors.push("任务标题未填写");
  if (!state.baseline.commit) errors.push("基线提交未记录；非 Git 项目请写 NO_GIT_BASELINE");
  if (!VALID_STATUS.includes(state.status)) {
    errors.push(`未知状态：${state.status}`);
  }

  const MARKERS = {
    plan: "- [x] 方案已确认",
    review: "- [x] 独立复核已完成",
    human: "- [x] 交付确认：人工静默通过",
  };

  if (name === "readiness") {
    if (state.status === "blocked") return errors;
    requireFile(taskDir, "prd.md", errors, "任务产物");
    requireFile(taskDir, "design.md", errors, "任务产物");
    if (!hasMarker(path.join(taskDir, "design.md"), MARKERS.plan)) {
      errors.push("开发方案尚未获得人工确认（design.md「方案确认」未勾选）");
    }
    return errors;
  }

  if (name !== "completion") return [`未知门禁：${name}`];

  if ((expectedStatus || state.status) !== "ready_for_review") errors.push("任务状态不是 ready_for_review");
  if (!hasMarker(path.join(taskDir, "design.md"), MARKERS.plan)) {
    errors.push("开发方案尚未获得人工确认（design.md「方案确认」未勾选）");
  }
  const ac = acceptanceCriteria(taskDir);
  if (ac.checked.length === 0) errors.push("prd.md 验收标准没有已勾选项");
  if (ac.unchecked.length > 0) errors.push(`prd.md 验收标准仍有 ${ac.unchecked.length} 项未勾选`);

  // 结构化验证记录：每条已勾选 AC 必须有对应记录；无 failed；skipped/not_run 必须说明原因
  const records = verificationRecords(taskDir);
  const recByAc = new Map();
  for (const r of records) {
    if (!recByAc.has(r.ac)) recByAc.set(r.ac, []);
    recByAc.get(r.ac).push(r);
  }
  for (const acId of ac.checked) {
    const rs = recByAc.get(acId) || [];
    if (rs.length === 0) {
      errors.push(`验收标准 ${acId} 缺少验证记录（review.md「验证记录」段：- [x] ${acId} | 验证方式: ... | 结果: passed | 证据: ...）`);
      continue;
    }
    for (const r of rs) {
      if (!r.result) errors.push(`${acId} 验证记录缺少结果字段（结果: passed | failed | skipped）`);
      else if (r.result === "failed") errors.push(`${acId} 验证记录结果为 failed，禁止通过`);
      else if ((r.result === "skipped" || r.result === "not_run") && !r.hasReason) {
        errors.push(`${acId} 验证记录为 ${r.result}，必须注明原因（追加“原因: ...”）；测试必须针对 prd 验收标准执行`);
      }
    }
  }

  // 大任务拆解：存在 subtasks.md 时所有子任务必须勾选
  const openSt = openSubtasks(taskDir);
  if (openSt.length > 0) {
    errors.push(`subtasks.md 仍有 ${openSt.length} 个子任务未完成（${openSt.join(", ")}）；全部勾选后才可交付`);
  }
  requireFile(taskDir, "review.md", errors, "最终复核记录");
  if (!hasMarker(path.join(taskDir, "review.md"), MARKERS.human)) {
    errors.push("交付前人工确认尚未记录（review.md「交付确认」未勾选）");
  }
  if (state.independentReview && !hasMarker(path.join(taskDir, "review.md"), MARKERS.review)) {
    errors.push("任务需要独立复核（review.md「独立复核」未勾选）");
  }
  return errors;
}

function init(args) {
  const repo = path.resolve(String(args.repo || "."));
  const taskId = String(args.task || "");
  const title = String(args.title || "");
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) throw new Error(`源码目录不存在：${repo}`);
  if (!/^[A-Za-z0-9._-]+$/.test(taskId)) throw new Error("--task 只能包含字母、数字、点、下划线和连字符");
  if (!title.trim()) throw new Error("缺少 --title");

  const taskDir = taskDirOf(repo, taskId);
  if (fs.existsSync(taskDir)) throw new Error(`任务目录已存在，不会覆盖：${taskDir}`);
  fs.mkdirSync(taskDir, { recursive: true });

  const branch = runGit(repo, ["branch", "--show-current"]) || "NO_GIT_BRANCH";
  const commit = runGit(repo, ["rev-parse", "HEAD"]) || "NO_GIT_BASELINE";
  const dirty = Boolean(runGit(repo, ["status", "--porcelain"]));
  const now = new Date().toISOString();

  const templateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "templates");
  const state = readJson(path.join(templateDir, "task.json"));
  state.taskId = taskId;
  state.title = title;
  state.baseline = { branch, commit, workingTreeInitiallyDirty: dirty };
  state.createdAt = now;
  writeJson(path.join(taskDir, "task-state.json"), state);

  for (const file of ["prd.md", "design.md", "review.md"]) {
    const tpl = path.join(templateDir, file);
    if (fs.existsSync(tpl)) fs.copyFileSync(tpl, path.join(taskDir, file));
  }

  process.stdout.write(`${JSON.stringify({ taskDir, statePath: path.join(taskDir, "task-state.json") }, null, 2)}\n`);
}

function list(args) {
  const repo = path.resolve(String(args.repo || "."));
  const tasksDir = path.join(repo, ".ai-sop", "tasks");
  if (!fs.existsSync(tasksDir)) {
    process.stdout.write("无活跃任务\n");
    return;
  }
  const rows = fs.readdirSync(tasksDir)
    .filter((name) => fs.statSync(path.join(tasksDir, name)).isDirectory())
    .map((name) => {
      const statePath = path.join(tasksDir, name, "task-state.json");
      if (!fs.existsSync(statePath)) return { taskId: name, title: "?", status: "?" };
      const state = readJson(statePath);
      return { taskId: name, title: state.title, status: state.status };
    });
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
}

function archive(args) {
  const repo = path.resolve(String(args.repo || "."));
  const taskId = String(args.task || "");
  const taskDir = taskDirOf(repo, taskId);
  if (!fs.existsSync(taskDir)) throw new Error(`任务目录不存在：${taskDir}`);

  const statePath = path.join(taskDir, "task-state.json");
  const state = fs.existsSync(statePath) ? readJson(statePath) : { taskId, title: taskId, status: "?" };
  state.status = "completed";
  state.updatedAt = new Date().toISOString();
  if (fs.existsSync(statePath)) writeState(taskDir, state);

  const archiveDir = path.join(repo, ".ai-sop", "archive");
  fs.mkdirSync(archiveDir, { recursive: true });
  const dest = path.join(archiveDir, taskId);
  if (fs.existsSync(dest)) throw new Error(`归档目录已存在：${dest}`);

  // 摘要行：编号 | 标题 | 状态 | 日期
  const date = new Date().toISOString().slice(0, 10);
  const line = `| ${taskId} | ${state.title.replace(/\|/g, "\\|")} | ${state.status} | ${date} |`;
  const indexPath = path.join(archiveDir, "index.md");
  const indexHeader = "# 归档索引\n\n| 编号 | 标题 | 状态 | 归档日期 |\n| --- | --- | --- | --- |\n";
  const existing = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf8") : indexHeader;
  const rows = existing.replace(indexHeader, "").trim();
  fs.writeFileSync(indexPath, `${indexHeader}${rows ? `${rows}\n` : ""}${line}\n`, "utf8");

  fs.renameSync(taskDir, dest);
  process.stdout.write(`${JSON.stringify({ archivedTo: dest, index: indexPath }, null, 2)}\n`);
}

function touch(state) {
  state.updatedAt = new Date().toISOString();
  return state;
}

// 状态机更新：校验合法状态；目标状态自动绑定门禁——
//   in_progress → readiness 门（产物 + 方案确认）；ready_for_review → completion 门（完成条件）
//   blocked / observing 为等待态，切换不校验；completed 只能由 archive 写入
function setStatus(args) {
  const repo = path.resolve(String(args.repo || "."));
  const taskId = String(args.task || "");
  const stateName = String(args.state || "");
  if (!taskId) throw new Error("缺少 --task");
  if (!VALID_STATUS.includes(stateName)) throw new Error(`非法状态：${stateName}，合法值：${VALID_STATUS.join(" / ")}`);
  const taskDir = taskDirOf(repo, taskId);
  const statePath = path.join(taskDir, "task-state.json");
  if (!fs.existsSync(statePath)) throw new Error(`任务不存在：${taskDir}`);
  const state = readState(taskDir);
  const from = state.status;

  if (stateName === "completed") {
    throw new Error("completed 状态只能通过 archive 命令写入；请用 archive 归档");
  }
  if (stateName === "in_progress") {
    const errors = gate(taskDir, "readiness");
    if (errors.length) throw new Error(`readiness 门未通过，拒绝切换：\n- ${errors.join("\n- ")}`);
  } else if (stateName === "ready_for_review") {
    const errors = gate(taskDir, "completion", "ready_for_review");
    if (errors.length) throw new Error(`completion 门未通过，拒绝切换：\n- ${errors.join("\n- ")}`);
  }

  state.status = stateName;
  touch(state);
  writeState(taskDir, state);
  process.stdout.write(`${JSON.stringify({ taskId, from, to: stateName, updatedAt: state.updatedAt }, null, 2)}\n`);
}

function selfTest() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "winin-dev-sop-"));
  try {
    const original = process.stdout.write;
    process.stdout.write = () => true;
    init({ repo, task: "TEST-1", title: "自检任务" });
    process.stdout.write = original;

    const taskDir = taskDirOf(repo, "TEST-1");
    if (gate(taskDir, "readiness").length === 0) throw new Error("空任务不应通过开工门禁");

    let overwriteBlocked = false;
    try {
      init({ repo, task: "TEST-1", title: "不应覆盖" });
    } catch {
      overwriteBlocked = true;
    }
    if (!overwriteBlocked) throw new Error("已有任务目录未阻止覆盖");

    // ── 机械命令验证 ──
    process.stdout.write = () => true;
    let badStatusRejected = false;
    try {
      setStatus({ repo, task: "TEST-1", state: "bogus" });
    } catch {
      badStatusRejected = true;
    }
    if (!badStatusRejected) throw new Error("非法状态未被拒绝");
    setStatus({ repo, task: "TEST-1", state: "blocked" });
    if (readState(taskDir).status !== "blocked") throw new Error("blocked 切换失败（等待态不校验门禁）");
    setStatus({ repo, task: "TEST-1", state: "planning" });
    if (readState(taskDir).status !== "planning") throw new Error("planning 回退失败");

    // 未确认方案 → 切 in_progress 应被 readiness 门拦截
    let readinessRejected = false;
    try {
      setStatus({ repo, task: "TEST-1", state: "in_progress" });
    } catch {
      readinessRejected = true;
    }
    if (!readinessRejected) throw new Error("未确认方案未被 readiness 门拦截");

    // 补方案确认 → 切 in_progress 成功
    fs.writeFileSync(path.join(taskDir, "design.md"), "# Design: TEST-1\n\n## 方案\n\n- 修改位置: 无\n\n## 方案确认\n\n- [x] 方案已确认\n");
    setStatus({ repo, task: "TEST-1", state: "in_progress" });
    if (readState(taskDir).status !== "in_progress") throw new Error("in_progress 切换失败");
    process.stdout.write = original;

    // 完成条件不齐（验收标准未勾选）→ 切 ready_for_review 应被 completion 门拦截
    let completionRejected = false;
    try {
      setStatus({ repo, task: "TEST-1", state: "ready_for_review" });
    } catch {
      completionRejected = true;
    }
    if (!completionRejected) throw new Error("验收标准未勾选未被 completion 门拦截");

    // independentReview 未勾选独立复核应被门禁拦截（先置标志再补齐产物）
    const state = readState(taskDir);
    state.independentReview = true;
    writeState(taskDir, state);

    fs.writeFileSync(path.join(taskDir, "prd.md"), "# PRD: TEST-1\n\n## 目标\n\n自检任务\n\n## 验收标准\n\n- [x] AC1: 门禁可验证\n");
    fs.writeFileSync(path.join(taskDir, "review.md"), "# 最终复核\n\n## 未执行项与剩余风险\n\n- 无\n\n## 验证记录\n\n- [x] AC1 | 验证方式: node self-test | 结果: passed | 证据: 自检输出\n\n## 独立复核\n\n- 复核人: self-test\n\n## 交付确认\n\n- [x] 交付确认：人工静默通过\n");
    let independentRejected = false;
    try {
      setStatus({ repo, task: "TEST-1", state: "ready_for_review" });
    } catch {
      independentRejected = true;
    }
    if (!independentRejected) throw new Error("independentReview 未勾选独立复核未被门禁拦截");

    // ── 结构化验证记录校验 ──
    // 勾选 AC2 但验证记录只覆盖 AC1 → 拒绝
    fs.writeFileSync(path.join(taskDir, "prd.md"), "# PRD: TEST-1\n\n## 目标\n\n自检任务\n\n## 验收标准\n\n- [x] AC1: 门禁可验证\n- [x] AC2: 验证记录覆盖\n");
    let missingRecordRejected = false;
    try {
      setStatus({ repo, task: "TEST-1", state: "ready_for_review" });
    } catch {
      missingRecordRejected = true;
    }
    if (!missingRecordRejected) throw new Error("勾选 AC 缺少验证记录未被门禁拦截");

    // 验证记录结果 failed → 拒绝
    fs.writeFileSync(path.join(taskDir, "review.md"), "# 最终复核\n\n## 未执行项与剩余风险\n\n- 无\n\n## 验证记录\n\n- [x] AC1 | 验证方式: node self-test | 结果: failed | 证据: 自检输出\n- [x] AC2 | 验证方式: node self-test | 结果: passed | 证据: 自检输出\n\n## 独立复核\n\n- [x] 独立复核已完成\n- 复核人: self-test\n\n## 交付确认\n\n- [x] 交付确认：人工静默通过\n");
    let failedRecordRejected = false;
    try {
      setStatus({ repo, task: "TEST-1", state: "ready_for_review" });
    } catch {
      failedRecordRejected = true;
    }
    if (!failedRecordRejected) throw new Error("failed 验证记录未被门禁拦截");

    // 验证记录 skipped 未注明原因 → 拒绝
    fs.writeFileSync(path.join(taskDir, "review.md"), "# 最终复核\n\n## 未执行项与剩余风险\n\n- 无\n\n## 验证记录\n\n- [x] AC1 | 验证方式: node self-test | 结果: skipped | 证据: 自检输出\n- [x] AC2 | 验证方式: node self-test | 结果: passed | 证据: 自检输出\n\n## 独立复核\n\n- [x] 独立复核已完成\n- 复核人: self-test\n\n## 交付确认\n\n- [x] 交付确认：人工静默通过\n");
    let skippedNoReasonRejected = false;
    try {
      setStatus({ repo, task: "TEST-1", state: "ready_for_review" });
    } catch {
      skippedNoReasonRejected = true;
    }
    if (!skippedNoReasonRejected) throw new Error("skipped 未注明原因未被门禁拦截");

    // ── 大任务拆解：subtasks.md 有未勾选子任务 → 拒绝 ──
    fs.writeFileSync(path.join(taskDir, "subtasks.md"), "# Subtasks: TEST-1\n\n## 子任务清单\n\n- [ ] ST1: 未完成\n- [x] ST2: 已完成\n");
    let subtaskOpenRejected = false;
    try {
      setStatus({ repo, task: "TEST-1", state: "ready_for_review" });
    } catch {
      subtaskOpenRejected = true;
    }
    if (!subtaskOpenRejected) throw new Error("subtasks.md 未勾选子任务未被门禁拦截");

    // 补齐验证记录 + 全部子任务勾选 → 切 ready_for_review 成功，两道门通过
    fs.writeFileSync(path.join(taskDir, "subtasks.md"), "# Subtasks: TEST-1\n\n## 子任务清单\n\n- [x] ST1: 已完成\n- [x] ST2: 已完成\n");
    fs.writeFileSync(path.join(taskDir, "review.md"), "# 最终复核\n\n## 未执行项与剩余风险\n\n- 无\n\n## 验证记录\n\n- [x] AC1 | 验证方式: node self-test | 结果: passed | 证据: 自检输出\n- [x] AC2 | 验证方式: node self-test | 结果: passed | 证据: 自检输出\n\n## 独立复核\n\n- [x] 独立复核已完成\n- 复核人: self-test\n\n## 交付确认\n\n- [x] 交付确认：人工静默通过\n");
    process.stdout.write = () => true;
    setStatus({ repo, task: "TEST-1", state: "ready_for_review" });
    process.stdout.write = original;
    if (readState(taskDir).status !== "ready_for_review") throw new Error("ready_for_review 切换失败");
    for (const name of ["readiness", "completion"]) {
      const errors = gate(taskDir, name);
      if (errors.length) throw new Error(`${name}：${errors.join("；")}`);
    }

    // completed 只能通过 archive 写入
    let completedRejected = false;
    try {
      setStatus({ repo, task: "TEST-1", state: "completed" });
    } catch {
      completedRejected = true;
    }
    if (!completedRejected) throw new Error("status completed 未被拒绝");

    process.stdout.write = () => true;
    archive({ repo, task: "TEST-1" });
    process.stdout.write = original;
    if (!fs.existsSync(path.join(repo, ".ai-sop", "archive", "TEST-1"))) throw new Error("归档目录未生成");
    if (!fs.readFileSync(path.join(repo, ".ai-sop", "archive", "index.md"), "utf8").includes("TEST-1")) throw new Error("归档索引未写入");

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
    const errors = gate(path.resolve(String(args["task-dir"] || "")), String(args.name || ""));
    if (errors.length) fail(`门禁未通过：\n- ${errors.join("\n- ")}`);
    else process.stdout.write(`${args.name} gate passed\n`);
  }
  else if (command === "archive") archive(args);
  else if (command === "list") list(args);
  else if (command === "status") setStatus(args);
  else if (command === "self-test") selfTest();
  else fail("用法：winin-sop.mjs <init|status|gate|archive|list|self-test> [参数]");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
