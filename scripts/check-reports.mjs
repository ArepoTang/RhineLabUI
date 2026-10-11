// 报告逻辑的断言：周期数学、原料挑选、统计、提示词拼接。
// 这些都是纯函数，跑法：npm run check:reports
import assert from "node:assert/strict";
import test from "node:test";

import { archiveMarkdown, exportedEntries, newEntry } from "../src/entries.ts";
import {
  anchoredPeriod,
  appendFacts,
  backlogPeriods,
  bulletLines,
  compressPrompt,
  longTermFacts,
  buildPrompt,
  canGenerate,
  defaultPrompts,
  lastWeekPeriod,
  missingSubPeriods,
  nextMissingPeriod,
  monthPeriod,
  periodRange,
  periodScope,
  periodStats,
  periodTitle,
  previousPeriod,
  statsBlock,
  subPeriods,
  weekPeriod,
  yearPeriod,
} from "../src/reports.ts";

const log = (date, body, created = Date.parse(`${date}T22:00:00`)) => ({
  ...newEntry(date, created, "log"),
  body,
});
const todo = (date, title, done = false) => ({ ...newEntry(date, Date.parse(`${date}T09:00:00`)), title, done });
const report = (period, body = period, date = periodRange(period).to) => ({
  ...newEntry(date, Date.parse(`${date}T23:00:00`), "report"),
  period,
  body,
});

test("周期键：ISO 周跨年、月初月末、年终", () => {
  assert.equal(weekPeriod("2026-01-01"), "2026-W01", "元旦落在 ISO 第 1 周");
  assert.equal(weekPeriod("2025-12-29"), "2026-W01", "跨年周归 ISO 年份");
  assert.equal(weekPeriod("2026-01-04"), "2026-W01", "周日仍属本周");
  assert.equal(weekPeriod("2026-01-05"), "2026-W02");
  assert.equal(weekPeriod("2026-10-12"), "2026-W42");
  assert.equal(monthPeriod("2026-10-12"), "2026-10");
  assert.equal(yearPeriod("2026-10-12"), "2026");
  assert.equal(periodScope("2026-W42"), "week");
  assert.equal(periodScope("2026-10"), "month");
  assert.equal(periodScope("2026"), "year");
});

test("周期区间：周一到周日、闰年二月、整年", () => {
  assert.deepEqual(periodRange("2026-W42"), { from: "2026-10-12", to: "2026-10-18" });
  assert.deepEqual(periodRange("2025-W01"), { from: "2024-12-30", to: "2025-01-05" });
  assert.deepEqual(periodRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(periodRange("2024-02"), { from: "2024-02-01", to: "2024-02-29" }, "闰年二月 29 天");
  assert.deepEqual(periodRange("2026"), { from: "2026-01-01", to: "2026-12-31" });
  assert.deepEqual(periodRange("2026-12").to, "2026-12-31");
});

test("上一期：跨年周、一月、年初", () => {
  assert.equal(previousPeriod("2026-W01"), "2025-W52", "2025 是 52 周的 ISO 年（元旦周三、非闰年）");
  assert.equal(weekPeriod("2025-01-01"), "2025-W01");
  assert.equal(previousPeriod("2026-W42"), "2026-W41");
  assert.equal(previousPeriod("2026-03"), "2026-02");
  assert.equal(previousPeriod("2026-01"), "2025-12");
  assert.equal(previousPeriod("2026"), "2025");
});

test("下级周期：月给出覆盖到的周（去重、升序），年给出 12 个月", () => {
  const weeks = subPeriods("2026-10");
  assert.ok(weeks.length >= 4 && weeks.length <= 6, `一个月覆盖 4~6 个周，实际 ${weeks.length}`);
  assert.deepEqual([...weeks].sort(), weeks);
  assert.equal(new Set(weeks).size, weeks.length);
  assert.ok(weeks.includes("2026-W42"));
  assert.equal(subPeriods("2026").length, 12);
  assert.equal(subPeriods("2026")[0], "2026-01");
  assert.deepEqual(subPeriods("2026-W42"), [], "周没有下级");
});

test("缺下级报告：周报永远可直接生成，月报/年报要等下级齐", () => {
  const entries = [log("2026-10-12", "a"), log("2026-10-13", "b")];
  assert.equal(canGenerate(entries, "2026-W42"), true);
  assert.equal(canGenerate(entries, "2026-10"), false, "缺周报时不能生成月报");
  const withWeeks = [...entries, ...subPeriods("2026-10").map((week) => report(week))];
  assert.equal(canGenerate(withWeeks, "2026-10"), true);
  assert.deepEqual(missingSubPeriods(entries, "2026-10"), subPeriods("2026-10"));
});

test("统计：条数、字数、最长的日志、最忙的一天、作息、完成率都由程序算", () => {
  const entries = [
    log("2026-10-12", "abc", Date.parse("2026-10-12T23:10:00")),
    log("2026-10-13", "abcdefghij", Date.parse("2026-10-13T23:40:00")),
    log("2026-10-14", "x", Date.parse("2026-10-14T08:05:00")),
    todo("2026-10-13", "交报告", true),
    todo("2026-10-13", "打电话"),
    todo("2026-10-15", "修导出"),
  ];
  const stats = periodStats(entries, "2026-W42");
  assert.equal(stats.logs, 3);
  assert.equal(stats.days, 3);
  assert.equal(stats.chars, 14);
  assert.deepEqual(stats.longestLog, { date: "2026-10-13", chars: 10 });
  assert.deepEqual(stats.busiestDay, { date: "2026-10-13", todos: 2 });
  assert.deepEqual(stats.topHour, { hour: 23, logs: 2 }, "23 点两次，8 点一次");
  assert.deepEqual(stats.todos, { total: 3, done: 1 });
  const block = statsBlock(stats);
  for (const fact of ["3 logs on 3 days", "14 characters", "2026-10-13", "23:00 (2 logs)", "1/3"]) {
    assert.ok(block.includes(fact), `统计块里应有 ${fact}：${block}`);
  }
});

test("统计不跨期：相邻周的日志与待办不混进本期", () => {
  const entries = [log("2026-10-12", "in"), log("2026-10-19", "next week"), todo("2026-10-19", "下周的事")];
  const stats = periodStats(entries, "2026-W42");
  assert.equal(stats.logs, 1);
  assert.equal(stats.todos.total, 0);
  assert.equal(periodStats(entries, "2026").reports.week, 0);
});

test("年报统计里的报告份数按周期层级分开数", () => {
  const entries = [report("2026-W40"), report("2026-W41"), report("2026-09"), report("2026")];
  const stats = periodStats(entries, "2026");
  assert.deepEqual(stats.reports, { week: 2, month: 1, year: 1 });
});

test("提示词：周报喂原料，月报喂周报，缺哪周补那周的日志", () => {
  const entries = [log("2026-10-12", "完成了导出桥"), log("2026-10-13", "修了导出编码")];
  const week = buildPrompt({ entries, period: "2026-W42", memory: "  ", prompts: defaultPrompts });
  assert.ok(week.text.startsWith("SYSTEM\n"));
  assert.ok(week.text.includes("USER\n"));
  assert.ok(week.user.includes("PERIOD: 2026-W42 (2026-10-12 .. 2026-10-18)"));
  assert.ok(week.user.includes("## 2026-10-12\n\n完成了导出桥"));
  assert.ok(week.user.includes("LONG-TERM FACTS:\nNone"), "空记忆写 None");
  assert.ok(!week.user.includes("{{"), "模板变量必须全部替换");

  const monthly = buildPrompt({ entries, period: "2026-10", memory: "memo", prompts: defaultPrompts });
  assert.ok(monthly.user.includes("memo"));
  assert.ok(!monthly.user.includes("STATISTICS"), "月报不注入统计块");

  const withWeek = [...entries, report("2026-W42", "本周做了导出桥")];
  const later = buildPrompt({ entries: withWeek, period: "2026-10", memory: "", prompts: defaultPrompts });
  assert.ok(later.user.includes("### 2026-W42\n\n本周做了导出桥"), "有周报就喂周报");
  assert.ok(!later.user.includes("## 2026-10-12"), "该周已有报告，不再重复喂日志");
});

test("提示词：年报带统计块且明说禁止重数", () => {
  const entries = [log("2026-03-01", "春"), log("2026-03-02", "夏")];
  const { user } = buildPrompt({ entries, period: "2026", memory: "", prompts: defaultPrompts });
  assert.ok(user.includes("STATISTICS (authoritative numbers computed by the app; never recount or alter them):"));
  assert.ok(user.includes("2 logs on 2 days"));
  assert.ok(user.includes("## This year"), "年报有叙事段");
  assert.ok(user.includes("every number must come from STATISTICS"));
});

test("提示词：自定义模板与恢复默认各走各的", () => {
  const entries = [log("2026-10-12", "a")];
  const custom = { ...defaultPrompts, week: "PERIOD {{period}}\n{{material}}" };
  const built = buildPrompt({ entries, period: "2026-W42", memory: "", prompts: custom });
  assert.equal(built.user, "PERIOD 2026-W42\n## 2026-10-12\n\na");
  const blank = buildPrompt({ entries, period: "2026-W42", memory: "", prompts: { ...defaultPrompts, system: "   " } });
  assert.equal(blank.system, defaultPrompts.system, "清空 system 时回落默认，不会发出空提示词");
});

test("周期标题与档案库导出：只有日志与报告，待办不进去", () => {
  assert.equal(periodTitle("2026-W42"), "2026 年第 42 周");
  assert.equal(periodTitle("2026-10"), "2026 年 10 月");
  assert.equal(periodTitle("2026"), "2026 年");
  const entries = [log("2026-10-12", "日志正文"), todo("2026-10-13", "交报告", true), report("2026-W42", "本周总结")];
  const md = archiveMarkdown(entries);
  assert.ok(md.includes("# 莱茵档案库 / RHINE LAB ARCHIVE"));
  assert.ok(md.includes("共 1 天日志 · 1 份报告"), "顶部统计不含待办");
  assert.ok(md.includes("## 日志") && md.includes("## 报告"));
  assert.ok(!md.includes("## 待办") && !md.includes("交报告"), "待办整段不出现");
  assert.ok(md.includes("### 2026-10-12\n\n日志正文"));
  assert.ok(md.includes("### 2026-W42\n\n本周总结"));
  assert.equal(archiveMarkdown([]), "");
  assert.equal(archiveMarkdown([todo("2026-10-13", "只有待办")]), "", "只有待办时导出为空（按钮据此禁用）");
  assert.deepEqual(exportedEntries(entries).map((e) => e.id), [entries[0].id, entries[2].id], "计数口径 = 日志 + 报告");
});

test("自动生成的目标：先补最近 8 周里最新的缺口，再轮到上月", () => {
  // 2026-10-14 是 W42 的周三 → 最近过完的一周是 W41（10-05 至 10-11）
  const entries = [log("2026-10-06", "上周有料"), log("2026-09-29", "W40"), log("2026-09-22", "W39")];
  const today = "2026-10-14";
  assert.equal(lastWeekPeriod(today), "2026-W41");
  assert.equal(nextMissingPeriod(entries, today), "2026-W41", "上一周缺口优先");
  assert.equal(nextMissingPeriod([...entries, report("2026-W41"), report("2026-W40")], today), "2026-W39", "更近的都有报告就往前补最新的缺口");
  const full = [...entries];
  for (let week = lastWeekPeriod(today), back = 0; back < 8; back += 1) { full.push(report(week)); week = previousPeriod(week); }
  assert.equal(nextMissingPeriod(full, today), "2026-09", "8 周窗口填满后轮到刚结束的上月");
});

test("没有材料的期不生成：上周没写过日志就不该冒出一份空周报", () => {
  const onlyThisWeek = [log("2026-10-12", "这周的")];
  assert.equal(nextMissingPeriod(onlyThisWeek, "2026-10-14"), null);
  assert.deepEqual(backlogPeriods(onlyThisWeek, "2026-10-14"), []);
  assert.equal(nextMissingPeriod([log("2026-10-06", "上周的")], "2026-10-14"), "2026-W41");
});

test("月报/年报要等下级齐了才自动生成", () => {
  const today = "2026-10-02"; // 10 月刚过：上月 = 2026-09
  const entries = [log("2026-09-22", "九月的日志")];
  assert.equal(nextMissingPeriod(entries, today), "2026-W39", "先补 9 月里的周报");
  assert.equal(nextMissingPeriod([...entries, ...subPeriods("2026-09").map((week) => report(week))], today), "2026-09", "周报齐了才补月报");
});

test("缺口清单：周在前、按月升序", () => {
  const entries = [log("2026-10-05", "W41"), log("2026-09-28", "W40"), log("2026-10-12", "W42（本期）")];
  assert.deepEqual(backlogPeriods(entries, "2026-10-14"), ["2026-W40", "2026-W41", "2026-09"], "本期周报不在缺口里；空白周也不在");
  assert.equal(backlogPeriods([], "2026-10-14").length, 0);
  assert.equal(backlogPeriods(entries, "2026-10-14", 2).length, 2, "limit 生效");
});

test("请求形状：OpenAI 兼容 /chat/completions，Bearer key，正文来自 choices[0]", async () => {
  const { chatEndpoint, requestReport } = await import("../src/report-run.ts");
  assert.equal(chatEndpoint("https://openrouter.ai/api/v1/"), "https://openrouter.ai/api/v1/chat/completions");
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: "## Summary\n\nok" } }] }), { status: 200 });
  };
  const text = await requestReport({
    provider: "https://example.test/v1", model: "some-model", key: "sk-123",
    prompt: { system: "SYS", user: "USER" }, fetchImpl: fake,
  });
  assert.equal(text, "## Summary\n\nok", "前后空白被去掉");
  assert.equal(calls[0].url, "https://example.test/v1/chat/completions");
  assert.equal(calls[0].init.headers.authorization, "Bearer sk-123");
  assert.deepEqual(calls[0].body.messages.map((m) => m.role), ["system", "user"]);
  assert.equal(calls[0].body.model, "some-model");
  assert.equal(calls[0].body.stream, false);
});

test("请求失败：HTTP 状态、非 JSON、空正文、缺 key 都给出能看懂的错", async () => {
  const { requestReport } = await import("../src/report-run.ts");
  const run = (fake) =>
    requestReport({ provider: "https://x.test/v1", model: "m", key: "k", prompt: { system: "s", user: "u" }, fetchImpl: fake });
  await assert.rejects(run(async () => new Response("bad key", { status: 401 })), /HTTP 401：bad key/);
  await assert.rejects(run(async () => new Response("<html>", { status: 200 })), /不是 JSON/);
  await assert.rejects(run(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })), /没有正文/);
  await assert.rejects(
    requestReport({ provider: "", model: "m", key: "k", prompt: { system: "s", user: "u" }, fetchImpl: async () => new Response("{}") }),
    /还没填服务商地址/,
  );
});

test("长期事实候选：认中英标题、只取到下一个标题、忽略 None", () => {
  const body = [
    "## Summary",
    "这周做了导出。",
    "## Long-term facts",
    "- 项目代号 Rhine",
    "* 每周五交报告 (10-16)",
    "3. 用的是 OpenRouter",
    "- None",
    "- 无",
    "## Next",
    "- 不该被收进来 (10-17)",
  ].join("\n");
  assert.deepEqual(longTermFacts(body), ["项目代号 Rhine", "每周五交报告 (10-16)", "用的是 OpenRouter"]);
  assert.deepEqual(longTermFacts("## 长期事实\n- 只有一条\n"), ["只有一条"]);
  assert.deepEqual(longTermFacts("没有任何候选段"), []);
  assert.deepEqual(longTermFacts("## Long-term facts\n(none)\n"), []);
});

test("记忆只追加：重复的不再写，手写的行不被删", () => {
  const memory = "- 项目代号 Rhine\n手写：只在工作时用这台设备";
  const { text, added } = appendFacts(memory, ["项目代号 rhine", "新增一条", " 新增一条 "]);
  assert.deepEqual(added, ["新增一条"], "大小写/空白不同视为同一条，同批内也去重");
  assert.ok(text.startsWith(memory), "原文一字不动");
  assert.ok(text.endsWith("- 新增一条"));
  const same = appendFacts(memory, ["项目代号 Rhine"]);
  assert.equal(same.text, memory, "没有新事实时不动文本");
  assert.deepEqual(same.added, []);
  assert.equal(appendFacts("", ["第一条"]).text, "- 第一条", "空记忆直接写第一条");
});

test("压缩提示词：带上记忆、禁止新增事实、只要项目符", () => {
  const { system, user } = compressPrompt("SYS", "- 甲\n- 乙");
  assert.equal(system, "SYS");
  assert.ok(user.includes("at most 20 bullets"));
  assert.ok(user.includes("Do NOT add facts"));
  assert.ok(user.includes("LONG-TERM FACTS:\n- 甲\n- 乙"), "原文附在后面");
  assert.ok(user.includes('each starting with "- "'));
  assert.ok(compressPrompt("   ", "- 甲").system.includes("report writer"), "空 system 回落默认");
  assert.ok(compressPrompt("SYS", "  ").user.includes("(none)"));
});

test("压缩结果解析：只要项目符，忽略解释性文字", () => {
  const compressed = "好的，压缩后的记忆：\n- 甲\n- 乙\n（共 2 条）";
  assert.deepEqual(bulletLines(compressed), ["甲", "乙"]);
});
