import content from "../content/archives.json" with { type: "json" };
import { BOX_COUNT, partition } from "./boxes.ts";
import { entryTitle, sortEntries, type Entry } from "./entries.ts";

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
}

// 必须是副本：records 会被原地清空重填，共用引用会把源数组一起清掉。
const builtinRecords: ArchiveRecord[] = [...content.records];
/** 阵列的两套内容来源：个人条目（盒子）与内置设定档案。 */
export type ArchiveSource = "entries" | "builtin";

/** 5 列各 8 个盒子，列名按盒子序号固定（容量按条数算，列不覆盖连续时间）。 */
export const BOX_COLUMNS = [1, 9, 17, 25, 33].map((first) => `盒子 ${first}–${first + 7}`);

// 注意：这些是可变数组，applyArchiveSource() 原地改写它们，导入方拿到的引用始终最新。
// archiveColumns 必须是副本 —— content.columns 是 import 进来的 JSON。
export const records: ArchiveRecord[] = [...content.records];
export const archiveColumns: string[] = [...content.columns];
export const categories: string[] = ["全部档案", ...content.categories];

const shortDay = (day: string) => `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8))} 日`;
const emptyBox = (index: number, column: string): ArchiveRecord => ({
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
});

/**
 * 把 40 个盒子映射成详情页能吃的档案记录。
 * 盒子是空的也要占位：阵列固定 40 个槽，且每列必须恰好 8 个 ——
 * archive-loop 的 wrap(row, files.length) 遇到空列会算出 NaN。
 */
export function boxRecords(entries: Entry[]): ArchiveRecord[] {
  const boxes = partition(entries);
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
    };
  });
}

export function applyArchiveSource(source: ArchiveSource, entries: Entry[] = []) {
  const source_ = source === "entries" ? boxRecords(entries) : builtinRecords;
  const columns = source === "entries" ? BOX_COLUMNS : [...content.columns];
  records.length = 0;
  records.push(...source_);
  archiveColumns.length = 0;
  archiveColumns.push(...columns);
  categories.length = 0;
  categories.push("全部档案", ...columns);
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
