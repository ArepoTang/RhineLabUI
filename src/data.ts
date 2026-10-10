import { BOX_COUNT, partition } from "./boxes.ts";
import { entryTitle, isLog, sortEntries, type Entry } from "./entries.ts";

export interface ArchiveRecord {
  id: string;
  title: string;
  en: string;
  department: string;
  category: string;
  date: string;
  lead: string;
  clearance: string;
  abstract: string;
  findings: string[];
  source: string;
  /** 个人条目盒子才有：条目 id（与 findings 一一对应），用来点击进编辑器。 */
  box?: { from: number; to: number; entryIds: string[] };
}

/** 5 列各 8 个盒子，列名按盒子序号固定（容量按条数算，列不覆盖连续时间）。 */
export const BOX_COLUMNS = [1, 9, 17, 25, 33].map((first) => `盒子 ${first}–${first + 7}`);

// 注意：这些是可变数组，applyArchiveSource() 原地改写它们，导入方拿到的引用始终最新。
// 初值是 40 个空盒：在条目读出来之前，阵列也必须每列恰好 8 个（见 archive-loop 的 wrap）。
export const records: ArchiveRecord[] = boxRecords([]);
export const archiveColumns: string[] = [...BOX_COLUMNS];
export const categories: string[] = ["全部档案", ...BOX_COLUMNS];

const shortDay = (day: string) => `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8))} 日`;
function emptyBox(index: number, column: string): ArchiveRecord {
  return {
    id: `BOX-${String(index + 1).padStart(3, "0")}`,
    title: "空盒",
    en: "EMPTY BOX",
    department: "个人条目",
    category: column,
    date: "—",
    lead: "—",
    clearance: "RESTRICTED",
    abstract: "这个盒子还是空的。",
    findings: [],
    source: "",
  };
}

/**
 * 把 40 个盒子映射成详情页能吃的档案记录。
 * 盒子只装日志（2026-10-10 与用户确认）：待办留在日历里，不进阵列。
 * 盒子是空的也要占位：阵列固定 40 个槽，且每列必须恰好 8 个 ——
 * archive-loop 的 wrap(row, files.length) 遇到空列会算出 NaN。
 */
export function boxRecords(entries: Entry[]): ArchiveRecord[] {
  const boxes = partition(entries.filter(isLog));
  return Array.from({ length: BOX_COUNT }, (_, index) => {
    const column = BOX_COLUMNS[Math.floor(index / 8)];
    const box = boxes[index];
    if (!box) return emptyBox(index, column);
    const ordered = sortEntries(box.entries);
    const days = ordered.map((entry) => entry.date).sort();
    return {
      id: `BOX-${String(index + 1).padStart(3, "0")}`,
      title: box.ordinal,
      en: `BOX ${String(index + 1).padStart(3, "0")}`,
      department: "个人条目",
      category: column,
      date: `第 ${box.from} – ${box.to} 条`,
      lead: "—",
      clearance: "AUTHORIZED",
      abstract: `共 ${ordered.length} 条 · ${shortDay(days[0])} – ${shortDay(days[days.length - 1])}`,
      findings: ordered.map((entry) => `${shortDay(entry.date)}${entry.time ? ` ${entry.time}` : ""} · ${entryTitle(entry)}`),
      source: "",
      box: { from: box.from, to: box.to, entryIds: ordered.map((entry) => entry.id) },
    };
  });
}

/** 阵列内容只有一个来源：个人日志装进盒子（内置设定档案已按用户要求移除）。 */
export function applyArchiveSource(entries: Entry[] = []) {
  const source = boxRecords(entries);
  records.length = 0;
  records.push(...source);
  archiveColumns.length = 0;
  archiveColumns.push(...BOX_COLUMNS);
  categories.length = 0;
  categories.push("全部档案", ...BOX_COLUMNS);
}

export function columnFiles(lane: number) {
  return records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.category === archiveColumns[lane])
    .map(({ index }) => index);
}
export function fileLocation(index: number) {
  const lane = archiveColumns.indexOf(records[index].category);
  const row = 12 + columnFiles(lane).indexOf(index);
  return { lane, row, slot: lane * 32 + row };
}
export function fileAtSlot(slot: number) {
  const files = columnFiles(Math.floor(slot / 32));
  return files[Math.max(0, Math.min(files.length - 1, (slot % 32) - 12))];
}
