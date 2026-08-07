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

function gitBaselineOf(dir) {
  // 只认自身就是仓库根（含 .git）的目录；避免 git -C 向上查找父仓库造成误判
  if (!fs.existsSync(path.join(dir, ".git"))) return { branch: "", commit: "", dirty: false };
  const branch = runGit(dir, ["branch", "--show-current"]);
  const commit = runGit(dir, ["rev-parse", "HEAD"]);
  const dirty = Boolean(runGit(dir, ["status", "--porcelain"]));
  return { branch: branch || "NO_GIT_BRANCH", commit: commit || "", dirty };
}

// 基线探测：工作区根是 git → 单仓库基线；根非 git → 扫描一、二级子目录中的 git 仓库记入 repos
// （支持 monorepo 形态：工作区根/领域目录/模块仓库，如 yx-mom 的 根/mom/win-module-wms）
function detectBaseline(repo) {
  const root = gitBaselineOf(repo);
  if (root.commit) {
    return { branch: root.branch, commit: root.commit, workingTreeInitiallyDirty: root.dirty, repos: [] };
  }
  const candidates = new Set();
  for (const name of fs.readdirSync(repo)) {
    const dir = path.join(repo, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    candidates.add(dir);
    for (const sub of fs.readdirSync(dir)) {
      const subDir = path.join(dir, sub);
      if (fs.statSync(subDir).isDirectory()) candidates.add(subDir);
    }
  }
  const repos = [];
  for (const dir of candidates) {
    const b = gitBaselineOf(dir);
    if (b.commit) {
      repos.push({ repo: path.relative(repo, dir).replace(/\\/g, "/"), branch: b.branch, commit: b.commit, workingTreeInitiallyDirty: b.dirty });
    }
  }
  return { branch: "NO_GIT_BRANCH", commit: "", workingTreeInitiallyDirty: false, repos };
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
  if (!state.baseline || typeof state.baseline !== "object") errors.push("基线未记录");
  else {
    const repos = state.baseline.repos || [];
    const hasSingle = Boolean(state.baseline.commit);
    if (!hasSingle && repos.length === 0) {
      errors.push("基线未记录：单仓库模式缺 commit，且 repos 为空（工作区需是 git 仓库或含 git 子仓库）");
    }
    if (repos.length > 0 && repos.some((r) => !r || !r.repo || !r.commit)) {
      errors.push("baseline.repos 存在缺 repo 或 commit 的项");
    }
  }
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

// 环境初始化：显式创建 .ai-sop 骨架（spec/ tasks/ archive/ + 域级规范索引模板 + README），幂等不覆盖
function initEnv(args) {
  const repo = path.resolve(String(args.repo || "."));
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) throw new Error(`源码目录不存在：${repo}`);
  const aiSopDir = path.join(repo, ".ai-sop");
  const created = [];
  for (const sub of ["spec", "tasks", "archive"]) {
    const dir = path.join(aiSopDir, sub);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created.push(path.join(".ai-sop", sub));
    }
  }
  const templateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "templates");
  // 规范骨架对齐 Trellis 范式：按域分目录，每域一个 index.md；根级 index.md 不是必须。
  // 已有规范（迁移/手写）时不创建任何模板。
  const specDir = path.join(aiSopDir, "spec");
  const hasExistingSpec = fs.readdirSync(specDir).some((name) => {
    const p = path.join(specDir, name);
    return (fs.statSync(p).isDirectory() && fs.readdirSync(p).some((f) => f.endsWith(".md"))) || name.endsWith(".md");
  });
  if (!hasExistingSpec) {
    for (const domain of ["backend", "frontend"]) {
      const idx = path.join(specDir, domain, "index.md");
      if (!fs.existsSync(idx)) {
        fs.mkdirSync(path.dirname(idx), { recursive: true });
        fs.copyFileSync(path.join(templateDir, "spec-domain-index.md"), idx);
        created.push(path.join(".ai-sop/spec", domain, "index.md"));
      }
    }
  }
  const readme = path.join(aiSopDir, "README.md");
  if (!fs.existsSync(readme)) {
    fs.copyFileSync(path.join(templateDir, "ai-sop-readme.md"), readme);
    created.push(".ai-sop/README.md");
  }
  process.stdout.write(`${JSON.stringify({ aiSopDir, created, note: "已存在的文件跳过，不覆盖" }, null, 2)}\n`);
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

  const now = new Date().toISOString();

  const templateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "templates");
  const state = readJson(path.join(templateDir, "task.json"));
  state.taskId = taskId;
  state.title = title;
  state.baseline = detectBaseline(repo);
  if (!state.baseline.commit && state.baseline.repos.length === 0) {
    throw new Error(`工作区既不是 git 仓库，直接子目录中也没有 git 仓库；请确认 --repo 指向源码工作区根`);
  }
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
    runGit(repo, ["init", "-q"]);
    runGit(repo, ["commit", "-q", "--allow-empty", "-m", "init"]);
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

// 环境初始化自检：空目录建域级骨架、幂等不覆盖、已有规范时不再创建模板
function selfTestInitEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "winin-sop-env-"));
  try {
    const original = process.stdout.write;
    process.stdout.write = () => true;
    initEnv({ repo: root });
    process.stdout.write = original;
    const expect = [".ai-sop/spec/backend/index.md", ".ai-sop/spec/frontend/index.md", ".ai-sop/README.md", ".ai-sop/tasks", ".ai-sop/archive"];
    for (const f of expect) {
      if (!fs.existsSync(path.join(root, f))) throw new Error(`init-env 未创建 ${f}`);
    }
    if (fs.existsSync(path.join(root, ".ai-sop/spec/index.md"))) throw new Error("根级 spec/index.md 不应被创建（Trellis 范式为域级）");
    const before = fs.readFileSync(path.join(root, ".ai-sop/spec/backend/index.md"), "utf8");
    process.stdout.write = () => true;
    initEnv({ repo: root });
    process.stdout.write = original;
    const after = fs.readFileSync(path.join(root, ".ai-sop/spec/backend/index.md"), "utf8");
    if (before !== after) throw new Error("init-env 二次执行覆盖了已有文件（应幂等）");

    // 已有规范（如整体迁移 Trellis spec）→ 不创建任何模板
    const migrated = fs.mkdtempSync(path.join(os.tmpdir(), "winin-sop-mig-"));
    fs.mkdirSync(path.join(migrated, ".ai-sop", "spec", "backend"), { recursive: true });
    fs.writeFileSync(path.join(migrated, ".ai-sop", "spec", "backend", "index.md"), "# 迁移的规范");
    process.stdout.write = () => true;
    initEnv({ repo: migrated });
    process.stdout.write = original;
    if (fs.existsSync(path.join(migrated, ".ai-sop", "spec", "frontend", "index.md"))) {
      throw new Error("已有规范时不应创建新域模板（保留原状）");
    }
    const migratedSpec = fs.readFileSync(path.join(migrated, ".ai-sop", "spec", "backend", "index.md"), "utf8");
    if (migratedSpec !== "# 迁移的规范") throw new Error("迁移的规范文件被覆盖");
    fs.rmSync(migrated, { recursive: true, force: true });

    process.stdout.write("winin-dev-sop init-env self-test passed\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// 多仓库工作区：根非 git，直接子目录含 git 仓库 → repos 基线
function selfTestMultiRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "winin-sop-multi-"));
  try {
    const original = process.stdout.write;
    process.stdout.write = () => true;
    for (const sub of ["mom/win-module-wms", "mom/win-module-mes"]) {
      const dir = path.join(root, sub);
      fs.mkdirSync(dir, { recursive: true });
      runGit(dir, ["init", "-q"]);
      fs.writeFileSync(path.join(dir, "x.txt"), sub);
      runGit(dir, ["add", "-A"]);
      runGit(dir, ["commit", "-q", "-m", "init"]);
    }
    init({ repo: root, task: "MES-T1", title: "多仓库基线" });
    process.stdout.write = original;

    const state = readState(taskDirOf(root, "MES-T1"));
    if (state.baseline.commit) throw new Error("多仓库工作区不应产生单仓库基线");
    if (state.baseline.repos.length !== 2) throw new Error(`应探测到 2 个子仓库，实际 ${state.baseline.repos.length}`);
    for (const r of state.baseline.repos) {
      if (!r.commit) throw new Error(`子仓库 ${r.repo} 缺少 commit`);
    }

    // 无 git 工作区 → init 应拒绝
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "winin-sop-plain-"));
    let rejected = false;
    try {
      process.stdout.write = () => true;
      init({ repo: plain, task: "MES-T2", title: "无 git" });
    } catch {
      rejected = true;
    } finally {
      process.stdout.write = original;
      fs.rmSync(plain, { recursive: true, force: true });
    }
    if (!rejected) throw new Error("无 git 工作区未被 init 拒绝");

    process.stdout.write("winin-dev-sop multi-repo self-test passed\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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
  else if (command === "self-test") {
    selfTest();
    selfTestMultiRepo();
    selfTestInitEnv();
  }
  else if (command === "init-env") initEnv(args);
  else fail("用法：winin-sop.mjs <init-env|init|status|gate|archive|list|self-test> [参数]");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
