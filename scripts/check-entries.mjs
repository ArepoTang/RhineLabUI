import assert from "node:assert/strict";
import { test } from "node:test";
import {
  entriesOn,
  monthGrid,
  newEntry,
  searchEntries,
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
  assert.match(html, /data-entry-day="2026-10-12"[^>]*aria-label="10 月 12 日 周一，1 条"[^>]*><span>12<\/span><i aria-hidden="true"><\/i>/);
  assert.ok(!/<i>\d/.test(html), "格子里的条数不该再是数字");
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

// ---- 盒子模型（容量阶梯、装填顺序、封顶）------------------------------------
const {
  BOX_COUNT, ENTRY_LIMIT, boxCapacity, boxUsed, canAdd, cellBox, boxCell,
  isFull, ordinalOf, partition,
} = await import("../src/boxes.ts");

const many = (count) => Array.from({ length: count }, (_, i) =>
  at(`id${String(i).padStart(4, "0")}`, "2026-10-06", "", `第 ${i + 1} 条`, "", false));

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
  const backfilled = at("late", "2020-01-01", "", "补写很久以前", "");
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
