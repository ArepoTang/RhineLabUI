import type { Entry } from "./entries.ts";

/**
 * 阵列的「盒子」模型：一个盒子 = 一批条目的装填单元。
 *
 * 规则（2026-10-06 与用户确认）：
 * - 阵列固定 40 个盒子（沿用现有 5 列 × 8 行的 40 个位置，布局不动）。
 * - 容量阶梯只有两级：总数 ≤ 40 时 1 条/盒；超过 40 条后 40 条/盒。
 * - 40 × 40 = 1600 条封顶，到顶后拒绝新条目（"篇目已满"）。
 * - 装填按**写入顺序**（created），不是按日期 —— 用户对第 41 条的原话是
 *   "前 40 条自动归到第一个盒子，41 条归第二个盒子"。所以给过去的日期补写一条，
 *   它不会钻进旧的盒子里，只会追加到最后一个盒子。
 * - 跨档时整体重排一次（1 条/盒 → 40 条/盒），此后新条目按 40 条/盒继续装。
 *
 * 盒子上写的是**序号**而不是日期区间：容量按条数算，盒子未必覆盖连续时间。
 */
export const BOX_COUNT = 40;
export const BOX_CAPACITY = 40;
export const ENTRY_LIMIT = BOX_COUNT * BOX_CAPACITY; // 1600

/** 跨档容量：≤40 条时一条一个盒子，超过后 40 条一个盒子。 */
export const boxCapacity = (total: number) => (total > BOX_COUNT ? BOX_CAPACITY : 1);
export const boxUsed = (total: number) => Math.ceil(total / boxCapacity(total));
export const isFull = (total: number) => total >= ENTRY_LIMIT;
/** 写入前的准入判断，编辑器保存时必须过这一关。 */
export const canAdd = (total: number) => total < ENTRY_LIMIT;

export type Box = {
  index: number;
  /** 盒面文字：单条时 `007`，多条时 `041 – 080`。 */
  ordinal: string;
  /** 第几条到第几条（1 基，含两端），用于详情页抬头。 */
  from: number;
  to: number;
  entries: Entry[];
};

const pad = (value: number) => String(value).padStart(3, "0");
export const ordinalOf = (from: number, to: number) => (from === to ? pad(from) : `${pad(from)} – ${pad(to)}`);

/** 写入顺序：先 created，再 id，保证同一次写入的多条也有确定次序。 */
export function insertionOrder(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
}

export function partition(entries: Entry[]): Box[] {
  const ordered = insertionOrder(entries).slice(0, ENTRY_LIMIT);
  const capacity = boxCapacity(ordered.length);
  return Array.from({ length: boxUsed(ordered.length) }, (_, index) => {
    const from = index * capacity + 1;
    const to = Math.min(ordered.length, (index + 1) * capacity);
    return { index, ordinal: ordinalOf(from, to), from, to, entries: ordered.slice(from - 1, to) };
  });
}

/** 阵列位置：沿用现有 5 列 × 8 行，行号从 12 起（与 archive-loop 的池子对齐）。 */
export function boxCell(index: number) {
  return { lane: Math.floor(index / 8), row: 12 + (index % 8) };
}
export function cellBox(lane: number, row: number) {
  const column = ((lane % 5) + 5) % 5;
  const within = ((row - 12) % 8 + 8) % 8;
  return column * 8 + within;
}
