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
