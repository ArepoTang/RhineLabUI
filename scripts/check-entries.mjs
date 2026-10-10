import assert from "node:assert/strict";
import { test } from "node:test";
import {
  entriesOn,
  entryKind,
  isLog,
  logLocked,
  logOn,
  logsMarkdown,
  monthGrid,
  newEntry,
  searchEntries,
  sortEntries,
} from "../src/entries.ts";

const at = (id, date, time, title, body, done = false, kind = "todo") => ({
  id,
  date,
  time,
  title,
  body,
  done,
  kind,
  created: 1_700_000_000_000,
  updated: 1_700_000_000_000,
});
const log = (id, date, body, created = 1_700_000_000_000) => ({
  ...at(id, date, "", "", body, false, "log"),
  created,
});

test("排序：同一天先按时间，无时间的在前", () => {
  const day = [at("c", "2026-10-06", "18:00", "", "晚上"), at("a", "2026-10-06", "", "", "全天"), at("b", "2026-10-06", "09:00", "", "早上")];
  assert.deepEqual(
    entriesOn([...day, at("x", "2026-10-07", "", "", "明天")], "2026-10-06").map((e) => e.body),
    ["全天", "早上", "晚上"],
  );
  assert.deepEqual(sortEntries(day)[0].date, "2026-10-06");
});

test("搜索覆盖标题、正文与日期", () => {
  const entries = [at("a", "2026-10-06", "", "晨会", "排期"), at("b", "2026-09-01", "", "买菜", "西红柿")];
  assert.deepEqual(searchEntries(entries, "排期").map((e) => e.id), ["a"]);
  assert.deepEqual(searchEntries(entries, "2026-09").map((e) => e.id), ["b"]);
  assert.deepEqual(searchEntries(entries, "  ").map((e) => e.id), ["b", "a"]);
  assert.deepEqual(searchEntries(entries, "不存在"), []);
});

test("月历是周一开头、整六周、跨月补齐", () => {
  const grid = monthGrid(2026, 9); // 2026-10（month 是 0 基）
  assert.equal(grid.length, 42);
  assert.equal(grid[0], "2026-09-28"); // 周一
  assert.ok(grid.includes("2026-10-01"));
  assert.ok(grid.includes("2026-11-08"));
  // 闰年二月也能落在同一形状里
  const feb = monthGrid(2028, 1);
  assert.equal(feb.length, 42);
  assert.ok(feb.includes("2028-02-29"));
});

test("newEntry 造出的条目形状正确", () => {
  const entry = newEntry("2026-10-06");
  assert.match(entry.id, /^[0-9a-f-]{36}$|^\d+-/);
  assert.equal(entry.date, "2026-10-06");
  assert.equal(entry.done, false);
  assert.equal(entry.body, "");
  assert.equal(entry.kind, "todo");
  assert.equal(newEntry("2026-10-06", Date.now(), "log").kind, "log");
});

// ---- 两种格式：待办与日志 ---------------------------------------------------
test("没有 kind 的旧数据算待办，日志只认 kind=log", () => {
  const legacy = { ...at("a", "2026-10-06", "", "", "旧笔记"), kind: undefined };
  assert.equal(entryKind(legacy), "todo");
  assert.equal(isLog(legacy), false);
  assert.equal(isLog(log("l", "2026-10-06", "今天")), true);
  assert.equal(entryKind(at("b", "2026-10-06", "", "", "待办")), "todo");
});

test("日志一天一条：取当天最早写入的那条", () => {
  const logs = [log("late", "2026-10-06", "晚写的", 1_700_000_000_002), log("early", "2026-10-06", "早写的", 1_700_000_000_001)];
  assert.equal(logOn(logs, "2026-10-06").id, "early");
  assert.equal(logOn(logs, "2026-10-05"), undefined);
  // 待办不算日志
  assert.equal(logOn([at("t", "2026-10-06", "", "", "待办")], "2026-10-06"), undefined);
});

test("日志过了本日只读；待办任何日期都可写", () => {
  const today = "2026-10-06";
  assert.equal(logLocked(log("a", today, "本日"), today), false);
  assert.equal(logLocked(log("b", "2026-10-05", "昨天"), today), true);
  assert.equal(logLocked(log("c", "2026-10-07", "明天"), today), false); // 未来没有入口，但不锁
  assert.equal(logLocked(at("d", "2020-01-01", "", "", "老待办"), today), false);
  assert.equal(logLocked(at("e", today, "", "", "今天的待办"), today), false);
});

// ---- 界面 markup（纯函数，可在 Node 里断言）--------------------------------
const { boardBodyMarkup, editorMarkup, entriesMarkup } = await import("../src/entries-ui.ts");

const board = (over = {}) => ({
  entries: [],
  selectedDay: "2026-10-06",
  today: "2026-10-06",
  monthAnchor: new Date(2026, 9, 1),
  query: "",
  error: "",
  ...over,
});

test("月历：42 格、周一开头、跨月压暗、今天与选中日被标记", () => {
  const html = boardBodyMarkup(board());
  assert.equal((html.match(/data-entry-day=/g) ?? []).length, 42);
  assert.match(html, /data-entry-day="2026-09-28"/); // 十月一日前的那个周一
  assert.match(html, /data-outside="true"/);
  assert.match(html, /aria-pressed="true"/); // 选中日
  assert.match(html, /10 月 6 日 · 周二/);
});

test("月历：小圆点=待办、方块=日志，无障碍名里写清条数", () => {
  const html = boardBodyMarkup(board({
    entries: [
      at("b", "2026-10-06", "18:00", "", "晚上"),
      at("a", "2026-10-06", "", "全天", "白天"),
      log("l", "2026-10-12", "写了日志"),
      at("c", "2026-10-13", "", "别天", "不该出现在 10-06 列表里"),
    ],
  }));
  assert.match(html, /data-entry-day="2026-10-06"[^>]*aria-label="10 月 6 日 周二，2 条待办"[^>]*><span>6<\/span><span class="entry-marks"><i class="entry-mark entry-mark-todo"[^>]*><\/i><\/span>/);
  assert.match(html, /data-entry-day="2026-10-12"[^>]*aria-label="10 月 12 日 周一，有日志"[^>]*><span>12<\/span><span class="entry-marks"><i class="entry-mark entry-mark-log"[^>]*><\/i><\/span>/);
  assert.match(html, /data-entry-day="2026-10-13"[^>]*aria-label="10 月 13 日 周二，1 条待办"/);
  assert.ok(html.indexOf("全天") < html.indexOf("晚上"));
  assert.equal((html.match(/data-entry-open=/g) ?? []).length, 2); // 列表只列当天的待办
});

test("选中日：待办列表 + 日志块，本日日志给编辑入口", () => {
  const html = boardBodyMarkup(board({
    entries: [at("a", "2026-10-06", "", "写周报", ""), log("l", "2026-10-06", "今天还行")],
  }));
  assert.match(html, /待办 · 10 月 6 日 · 周二/);
  assert.match(html, /data-entry-new="2026-10-06"/);
  assert.match(html, /<article class="entry-log" data-locked="false">/);
  assert.match(html, /data-entry-log="2026-10-06">编辑日志/);
  assert.ok(!html.includes("entry-log-note"), "本日日志不该有只读标记");
  assert.ok(!html.includes("写今天的日志"));
});

test("过日的日志只读：正文照显示，不给编辑按钮", () => {
  const html = boardBodyMarkup(board({
    selectedDay: "2026-10-05",
    monthAnchor: new Date(2026, 9, 1),
    entries: [log("l", "2026-10-05", "昨天的日志")],
  }));
  assert.match(html, /<article class="entry-log" data-locked="true">/);
  assert.match(html, /<span class="entry-log-note">只读<\/span>/);
  assert.match(html, /昨天的日志/);
  assert.ok(!html.includes("data-entry-log="));
});

test("本日没有日志时给写入口，过去与未来都不给", () => {
  assert.match(boardBodyMarkup(board()), /data-entry-log="2026-10-06">写今天的日志/);
  assert.match(boardBodyMarkup(board({ selectedDay: "2026-10-05" })), /这一天没有日志。/);
  assert.match(boardBodyMarkup(board({ selectedDay: "2026-10-07" })), /还没到这一天/);
});

test("没有待办时给出空状态，而不是空白", () => {
  assert.match(boardBodyMarkup(board()), /这一天没有待办/);
});

test("条目文本被转义，标题与正文里的 HTML 不会执行", () => {
  const html = boardBodyMarkup(board({
    entries: [at("x", "2026-10-06", "", '<img src=x onerror="boom()">', "<script>boom()</script>"), log("l", "2026-10-06", "<script>log()</script>")],
  }));
  assert.ok(!html.includes("<img"), "标题未转义");
  assert.ok(!html.includes("<script>"), "正文未转义");
});

test("搜索态：命中列表跨日期显示，日志带格式标记且只读的仍标注", () => {
  const html = boardBodyMarkup(board({
    query: "排期",
    entries: [at("a", "2026-10-06", "", "晨会", "排期"), log("l", "2026-11-02", "排期复盘")],
  }));
  assert.match(html, /搜索 · 排期/);
  assert.match(html, /2 条/);
  assert.match(html, /2026-10-06/);
  assert.match(html, /data-kind="log"/);
  assert.ok(!html.includes("data-entry-day"), "搜索态不该再画月历");
});

test("日历外观带上搜索框与存储错误提示", () => {
  assert.match(entriesMarkup(board()), /id="entry-search"/);
  assert.match(entriesMarkup(board({ error: "存储坏了" })), /存储坏了/);
  assert.match(entriesMarkup(board()), /待办与日志/);
  assert.ok(!entriesMarkup(board()).includes("modal-bottom"), "限制说明不该出现在日历页");
});

test("编辑器：待办带日期、时间与删除；日志只有正文、没有删除", () => {
  const editing = editorMarkup(at("a", "2026-10-06", "09:30", "晨会", "正文"), "2026-10-06");
  assert.match(editing, /data-action="delete-entry"/);
  assert.match(editing, /value="晨会"/);
  assert.match(editing, /value="09:30"/);
  assert.match(editing, />正文</);
  const fresh = editorMarkup(undefined, "2026-10-07");
  assert.ok(!fresh.includes("delete-entry"));
  assert.match(fresh, /value="2026-10-07"/);

  const editingLog = editorMarkup(log("l", "2026-10-06", "今天"), "2026-10-06");
  assert.match(editingLog, /写日志|编辑日志/);
  assert.match(editingLog, /id="entry-body-field"/);
  assert.ok(!editingLog.includes("delete-entry"), "日志不能删除");
  assert.ok(!editingLog.includes('id="entry-date"'), "日志没有日期字段");
  assert.ok(!editingLog.includes('id="entry-time"'), "日志没有时间字段");
  assert.ok(!editingLog.includes('id="entry-title"'), "日志没有标题字段");
  const newLog = editorMarkup(undefined, "2026-10-06", "log");
  assert.match(newLog, /NEW LOG/);
  assert.ok(!newLog.includes("一天一条"), "编辑器不该带限制说明");
  assert.ok(!newLog.includes("delete-entry"));
});

// ---- 盒子模型（容量阶梯、装填顺序、封顶）------------------------------------
const {
  BOX_COUNT, ENTRY_LIMIT, boxCapacity, boxUsed, canAdd, cellBox, boxCell,
  isFull, ordinalOf, partition,
} = await import("../src/boxes.ts");

const many = (count, kind = "log") => Array.from({ length: count }, (_, i) =>
  at(`id${String(i).padStart(4, "0")}`, "2026-10-06", "", `第 ${i + 1} 条`, "", false, kind));

test("容量阶梯只有两级：≤40 一条一盒，>40 后 40 条一盒", () => {
  assert.equal(boxCapacity(0), 1);
  assert.equal(boxCapacity(40), 1);
  assert.equal(boxCapacity(41), 40);
  assert.equal(boxCapacity(1600), 40);
  assert.equal(boxUsed(0), 0);
  assert.equal(boxUsed(40), 40);
  assert.equal(boxUsed(41), 2);
  assert.equal(boxUsed(80), 2);
  assert.equal(boxUsed(81), 3);
  assert.equal(boxUsed(1600), 40);
});

test("41 条时：前 40 条并进第一个盒子，第 41 条进第二个", () => {
  const boxes = partition(many(41));
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0].entries.length, 40);
  assert.equal(boxes[0].from, 1);
  assert.equal(boxes[0].to, 40);
  assert.equal(boxes[0].ordinal, "001 – 040");
  assert.equal(boxes[0].entries[0].title, "第 1 条");
  assert.equal(boxes[0].entries[39].title, "第 40 条");
  assert.deepEqual([boxes[1].from, boxes[1].to, boxes[1].entries.length], [41, 41, 1]);
  assert.equal(boxes[1].ordinal, "041");
});

test("40 条时每条一个盒子，序号是单号不是区间", () => {
  const boxes = partition(many(40));
  assert.equal(boxes.length, BOX_COUNT);
  assert.equal(boxes[6].ordinal, "007");
  assert.equal(boxes[6].entries[0].title, "第 7 条");
});

test("1600 条正好装满 40 个盒子，之后拒绝新增", () => {
  const boxes = partition(many(ENTRY_LIMIT));
  assert.equal(boxes.length, BOX_COUNT);
  assert.equal(boxes[39].ordinal, ordinalOf(1561, 1600));
  assert.equal(canAdd(ENTRY_LIMIT - 1), true);
  assert.equal(canAdd(ENTRY_LIMIT), false);
  assert.equal(isFull(ENTRY_LIMIT), true);
  // 超出的条目不会被悄悄塞进阵列，而是被截断（写入路径负责先拒绝）
  assert.equal(partition(many(ENTRY_LIMIT + 5)).length, BOX_COUNT);
});

test("按写入顺序装填，补写旧日期的条目不回填旧盒子", () => {
  const backfilled = at("late", "2020-01-01", "", "补写很久以前", "", false, "log");
  backfilled.created = 1_700_000_000_001; // 最后才写（其余条目的 created 是 1_700_000_000_000）
  const boxes = partition([...many(41), backfilled]);
  assert.equal(boxes[1].entries.at(-1).title, "补写很久以前");
  assert.equal(boxes[0].entries.some((e) => e.title === "补写很久以前"), false);
});

test("40 个盒子正好铺满 5 列 × 8 行，行列可互相换算", () => {
  assert.deepEqual(boxCell(0), { lane: 0, row: 12 });
  assert.deepEqual(boxCell(7), { lane: 0, row: 19 });
  assert.deepEqual(boxCell(8), { lane: 1, row: 12 });
  assert.deepEqual(boxCell(39), { lane: 4, row: 19 });
  for (let index = 0; index < BOX_COUNT; index++) {
    const { lane, row } = boxCell(index);
    assert.equal(cellBox(lane, row), index);
  }
  // 阵列是循环的，负数与越界列都要能绕回来
  assert.equal(cellBox(-1, 12), 32);
  assert.equal(cellBox(5, 12), 0);
  assert.equal(cellBox(0, 20), 0);
});

// ---- 盒子 → 档案记录（详情页/阵列实际读的就是这些字段）-----------------------
const { BOX_COLUMNS, applyArchiveSource, archiveColumns, boxRecords, records, columnFiles } = await import("../src/data.ts");

test("盒子只装日志：待办不进阵列，空盒照占位", () => {
  const mixed = [...many(3, "log"), ...many(5, "todo")];
  const filled = boxRecords(mixed).filter((record) => record.title !== "空盒");
  assert.equal(filled.length, 3, "只有日志占盒");
  const empty = boxRecords(many(5, "todo"));
  assert.ok(empty.every((record) => record.title === "空盒"), "没有日志时全是空盒");
  assert.equal(empty[0].clearance, "RESTRICTED");
  assert.match(empty[0].abstract, /还是空的/);
  assert.equal(empty[0].findings.length, 0);
});

test("40 个盒子永远是 40 条记录，空的也占位（每列必须恰好 8 个）", () => {
  for (const count of [0, 1, 41, 1600]) {
    const list = boxRecords(many(count));
    assert.equal(list.length, BOX_COUNT);
    for (let lane = 0; lane < 5; lane++)
      assert.equal(list.filter((r) => r.category === BOX_COLUMNS[lane]).length, 8, `${count} 条时第 ${lane} 列不是 8 个`);
  }
});

test("盒子记录带上详情页需要的字段：序号、条数区间、日期范围、逐条研究记录", () => {
  const entries = many(41).map((entry, i) => ({
    ...entry,
    date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`,
    title: `第 ${i + 1} 天`,
  }));
  const [first, second] = boxRecords(entries);
  assert.equal(first.id, "BOX-001");
  assert.equal(first.en, "BOX 001");
  assert.equal(first.title, "001 – 040");
  assert.equal(first.date, "第 1 – 40 条");
  assert.equal(first.department, "个人条目");
  assert.match(first.abstract, /^共 40 条 · /);
  assert.equal(first.findings.length, 40);
  assert.match(first.findings[0], /月 \d+ 日/);
  assert.equal(second.title, "041");
  assert.equal(second.findings.length, 1);
});

test("阵列内容只有一种来源：原地改写 records/archiveColumns/categories", () => {
  const before = records; // 模拟场景与详情页持有的引用
  applyArchiveSource(many(9));
  assert.equal(before, records, "数组引用必须保持不变");
  assert.equal(before.length, BOX_COUNT);
  assert.equal(before[0].id, "BOX-001");
  assert.equal(before[8].category, BOX_COLUMNS[1]);
  assert.equal(columnFiles(0).length, 8);
  assert.equal(columnFiles(1)[0], 8); // 第 9 个盒子是第 1 列的第一格
  assert.deepEqual(archiveColumns, BOX_COLUMNS);
  // 待办不改变阵列（还是只有 9 个盒子被填）
  applyArchiveSource([...many(9), ...many(4, "todo")]);
  assert.equal(before.filter((record) => record.title !== "空盒").length, 9);
});

test("列内偏移在任何来源下都落在目标列（列记忆曾错在这里）", async () => {
  const { fileLocation: at_, columnFiles: inColumn, applyArchiveSource: source } = await import("../src/data.ts");
  source(many(41));
  for (let lane = 0; lane < 5; lane++) {
    const files = inColumn(lane);
    assert.equal(files.length, 8, `盒子视图第 ${lane} 列不是 8 个`);
    for (let offset = 0; offset < 8; offset++)
      assert.equal(at_(files[offset]).lane, lane, `盒子视图 offset ${offset} 落到了第 ${at_(files[offset]).lane} 列`);
  }
});

test("日历样式不许再硬编码颜色：一律走主题变量（暗色靠变量跟随）", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../src/entries.css", import.meta.url), "utf8");
  // 允许：var(--theme-x, #fallback) 里的回退值，以及危险色两个例外
  const allowed = new Set(["#9b4a3f", "#d98d7c"]);
  const rest = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/var\(--theme-[a-z-]+,\s*#[0-9a-fA-F]{3,8}\)/g, "");
  const stray = [...new Set(rest.match(/#[0-9a-fA-F]{3,8}/g) ?? [])].filter((hex) => !allowed.has(hex));
  assert.deepEqual(stray, [], `这些颜色没走主题变量：${stray.join(", ")}`);
});

test("导出：只导日志、按日期升序、一天一段，正文原样", () => {
  const markdown = logsMarkdown([
    log("b", "2026-10-09", "第二天"),
    at("t", "2026-10-09", "", "待办", "不该出现"),
    log("a", "2026-10-08", "第一天"),
  ]);
  assert.match(markdown, /^# 莱茵日志/);
  assert.match(markdown, /共 2 天 · 2026-10-08 – 2026-10-09/);
  assert.ok(markdown.indexOf("## 2026-10-08") < markdown.indexOf("## 2026-10-09"), "日期要升序");
  assert.match(markdown, /\n## 2026-10-08\n\n第一天/);
  assert.ok(!markdown.includes("待办"), "待办不进导出");
  assert.equal(logsMarkdown([]), "", "没有日志时返回空串（按钮据此禁用）");
  assert.equal(logsMarkdown([at("t", "2026-10-08", "", "", "只有待办")]), "");
});

test("日历页带导出按钮：有日志时可用并显示天数，没有时禁用", () => {
  const empty = entriesMarkup(board());
  assert.match(empty, /data-action="export-logs"/);
  assert.match(empty, />导出日志<\/button>/, "按钮文字存在");
  assert.match(empty, /data-action="export-logs" disabled/);
  const filled = entriesMarkup(board({ entries: [log("a", "2026-10-08", "一"), log("b", "2026-10-09", "二")] }));
  // 「今天」按钮在选中本日时本来就是 disabled，所以只查导出按钮自己
  assert.match(filled, /data-action="export-logs">导出日志 <span>2<\/span>/, "有日志时不该禁用");
});

test("导出出口：有宿主桥就交给它写文件，没有桥或桥出错就回退浏览器下载", async () => {
  const { saveViaHost } = await import("../src/host-export.ts");
  // 浏览器里没有 window.RhineLabExport（Node 里连 window 都没有）
  assert.equal(saveViaHost("a.md", "x"), "");
  const calls = [];
  globalThis.window = { RhineLabExport: { saveLog: (name, text) => { calls.push([name, text]); return " Documents/RhineLab/a.md "; } } };
  assert.equal(saveViaHost("a.md", "正文"), "Documents/RhineLab/a.md", "返回值要去掉空白");
  assert.deepEqual(calls, [["a.md", "正文"]]);
  globalThis.window.RhineLabExport = { saveLog: () => { throw new Error("boom"); } };
  assert.equal(saveViaHost("a.md", "正文"), "", "宿主抛错不能把导出打断");
  delete globalThis.window;
});
