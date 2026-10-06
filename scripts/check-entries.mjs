import assert from "node:assert/strict";
import { test } from "node:test";
import {
  entriesOn,
  isEntry,
  monthGrid,
  newEntry,
  parseEntries,
  searchEntries,
  serializeEntries,
  sortEntries,
} from "../src/entries.ts";

const at = (id, date, time, title, body, done = false) => ({
  id,
  date,
  time,
  title,
  body,
  done,
  created: 1_700_000_000_000,
  updated: 1_700_000_000_000,
});

test("markdown 往返无损（含空正文、冒号、正文里的 --- 与缩进代码块）", () => {
  const entries = [
    at("a", "2026-10-06", "09:30", "晨会: 排期", "讨论 **条目** 模型\n\n---\n\n```ts\nconst x = 1;\n```"),
    at("b", "2026-10-06", "", "", ""),
    at("c", "2026-10-07", "", "只有标题的笔记", ""),
    at("d", "2026-09-30", "23:59", "", "多行\n正文\n\n\n结尾空行不保留", true),
  ];
  const again = parseEntries(serializeEntries(entries));
  assert.equal(again.length, 4);
  assert.deepEqual(
    again.map(({ id, date, time, title, body, done }) => ({ id, date, time, title, body, done })),
    [...entries]
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      .map(({ id, date, time, title, body, done }) => ({ id, date, time, title, body, done: done })),
  );
});

test("往返两次结果稳定（第二次序列化与第一次逐字节相同）", () => {
  const entries = [at("a", "2026-10-06", "09:30", "晨会", "正文"), at("b", "2026-01-02", "", "", "只有正文")];
  const once = serializeEntries(entries);
  assert.equal(serializeEntries(parseEntries(once)), once);
});

test("坏输入被跳过而不是抛错", () => {
  assert.deepEqual(parseEntries(""), []);
  assert.deepEqual(parseEntries("就是一段普通 markdown\n没有 front matter"), []);
  assert.deepEqual(parseEntries("---\ndate: 2026-13-45\n---\n正文"), []);
  assert.deepEqual(parseEntries("---\ntitle: 缺日期\n---\n正文"), []);
});

test("导入时缺 id 会补一个，时间格式不合法则丢弃", () => {
  const [entry] = parseEntries("---\ndate: 2026-10-06\ntime: 9点半\n---\n正文");
  assert.ok(entry.id);
  assert.equal(entry.time, "");
  assert.ok(isEntry(entry));
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

test("newEntry 造出的条目能被 isEntry 与往返接受", () => {
  const entry = newEntry("2026-10-06");
  assert.ok(isEntry(entry));
  assert.equal(parseEntries(serializeEntries([entry]))[0].id, entry.id);
});

// ---- 界面 markup（纯函数，可在 Node 里断言）--------------------------------
const { boardBodyMarkup, editorMarkup, entriesMarkup } = await import("../src/entries-ui.ts");

const board = (over = {}) => ({
  entries: [],
  selectedDay: "2026-10-06",
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

test("月历：条目数量显示在格子里，当天列表按时间排序", () => {
  const html = boardBodyMarkup(board({
    entries: [
      at("b", "2026-10-06", "18:00", "", "晚上"),
      at("a", "2026-10-06", "", "全天", "白天"),
      at("c", "2026-10-12", "", "别天", "不该出现在 10-06 列表里"),
    ],
  }));
  assert.match(html, /data-entry-day="2026-10-12"[^>]*><span>12<\/span><i>1<\/i>/);
  assert.ok(html.indexOf("全天") < html.indexOf("晚上"));
  assert.equal((html.match(/data-entry-open=/g) ?? []).length, 2);
});

test("没有条目时给出空状态，而不是空白", () => {
  assert.match(boardBodyMarkup(board()), /这一天还没有条目/);
});

test("条目文本被转义，标题与正文里的 HTML 不会执行", () => {
  const html = boardBodyMarkup(board({
    entries: [at("x", "2026-10-06", "", '<img src=x onerror="boom()">', "<script>boom()</script>")],
  }));
  assert.ok(!html.includes("<img"), "标题未转义");
  assert.ok(!html.includes("<script>"), "正文未转义");
});

test("搜索态：命中列表跨日期显示，并标出结果条数", () => {
  const html = boardBodyMarkup(board({
    query: "排期",
    entries: [at("a", "2026-10-06", "", "晨会", "排期"), at("b", "2026-11-02", "", "买菜", "西红柿")],
  }));
  assert.match(html, /搜索 · 排期/);
  assert.match(html, /1 条/);
  assert.match(html, /2026-10-06/);
  assert.ok(!html.includes("data-entry-day"), "搜索态不该再画月历");
});

test("日历外观带上搜索框与存储错误提示", () => {
  assert.match(entriesMarkup(board()), /id="entry-search"/);
  assert.match(entriesMarkup(board({ error: "存储坏了" })), /存储坏了/);
});

test("编辑器：编辑时带删除按钮与已有值，新建时没有删除按钮", () => {
  const editing = editorMarkup(at("a", "2026-10-06", "09:30", "晨会", "正文"), "2026-10-06");
  assert.match(editing, /data-action="delete-entry"/);
  assert.match(editing, /value="晨会"/);
  assert.match(editing, /value="09:30"/);
  assert.match(editing, />正文</);
  const fresh = editorMarkup(undefined, "2026-10-07");
  assert.ok(!fresh.includes("delete-entry"));
  assert.match(fresh, /value="2026-10-07"/);
});
