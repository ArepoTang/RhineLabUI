import { dayKey, parseTarget } from "./workbench-state.ts";

/**
 * 一条条目：锚在某一天上的一段文本。
 *
 * 只有两种格式（2026-10-10 与用户确认）：
 * - todo（待办）：一天可以多条，任何日期都能改、能勾、能删，时间可选。
 * - log（日志）：一天只有一条，只有正文，过了本日只读（不能改也不能删）。
 * 旧数据没有 kind 字段，一律当待办。
 *
 * 存储就是本机 IndexedDB，没有导出格式：Android 的 Chrome 与 WebView 都没有
 * showDirectoryPicker()，纯网页拿不到可读写的目录，以文件为真源就必须写原生桥。
 * 代价是清应用数据或换机会丢，需要备份时再加序列化（格式决定很便宜）。
 */
export type EntryKind = "todo" | "log";

export type Entry = {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // "" 或 HH:mm（日志不使用）
  title: string;
  body: string; // Markdown
  done: boolean;
  kind?: EntryKind;
  created: number;
  updated: number;
};

export const entryKind = (entry: Entry): EntryKind => (entry.kind === "log" ? "log" : "todo");
export const isLog = (entry: Entry) => entryKind(entry) === "log";

/** 日志一天一条：取当天那条（导入的数据理论上可能多于一条，用最早的一条）。 */
export const logOn = (entries: Entry[], date: string): Entry | undefined =>
  sortEntries(entries.filter((entry) => isLog(entry) && entry.date === date))[0];

/** 日志过了本日就归档：用 ISO 日期字符串直接比较即可。 */
export const logLocked = (entry: Entry, today = dayKey(new Date())) => isLog(entry) && entry.date < today;

/**
 * 导出的 Markdown：一天一段，日期当标题，正文原样。
 * 纯文本、无元数据 —— 导出来是给自己看的，不是给程序读的。
 */
export function logsMarkdown(entries: Entry[]): string {
  const logs = sortEntries(entries.filter(isLog));
  if (!logs.length) return "";
  const range = logs[0].date === logs[logs.length - 1].date
    ? logs[0].date
    : `${logs[0].date} – ${logs[logs.length - 1].date}`;
  return [
    "# 莱茵日志 / RHINE LAB LOG",
    "",
    `共 ${logs.length} 天 · ${range}`,
    ...logs.map((entry) => `\n## ${entry.date}\n\n${entry.body.trim()}`),
    "",
  ].join("\n");
}

export const entryTitle = (entry: Entry, fallback = "未命名"): string =>
  entry.title.trim() || entry.body.trim().split("\n")[0]?.replace(/^#+\s*/, "").slice(0, 40) || fallback;

/** 有时间的排在当天无时间的之前；同一天内按时间、再按创建顺序。 */
export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    const at = parseTarget(a.time ? `${a.date} ${a.time}` : a.date) ?? 0;
    const bt = parseTarget(b.time ? `${b.date} ${b.time}` : b.date) ?? 0;
    if (at !== bt) return at - bt;
    return a.created - b.created;
  });
}

export const entriesOn = (entries: Entry[], date: string): Entry[] =>
  sortEntries(entries.filter((entry) => entry.date === date));

export function searchEntries(entries: Entry[], query: string): Entry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sortEntries(entries);
  return sortEntries(
    entries.filter((entry) =>
      `${entry.date} ${entry.time} ${entry.title} ${entry.body}`.toLowerCase().includes(needle),
    ),
  );
}

/** 周一开头、整六周的格子，含上下月补齐的日期。 */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) =>
    dayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)),
  );
}

const MONTHS = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
export const monthLabel = (year: number, month: number) => `${year} 年 ${MONTHS[month]}`;

/** 形如 YYYY-MM-DD 且真的存在这一天（parseTarget 会做 Y/M/D 回读校验）。 */
export const isDayKey = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && parseTarget(value) !== null;

export function newEntry(date: string, now = Date.now(), kind: EntryKind = "todo"): Entry {
  return {
    // crypto.randomUUID 在 https 与 localhost 下都有；WebView 走 https origin 也在范围内。
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${now}-${Math.random().toString(36).slice(2, 8)}`,
    date,
    time: "",
    title: "",
    body: "",
    done: false,
    kind,
    created: now,
    updated: now,
  };
}

export const isEntry = (value: unknown): value is Entry => {
  const entry = value as Partial<Entry> | null;
  return (
    !!entry &&
    typeof entry.id === "string" &&
    isDayKey(entry.date) &&
    typeof entry.body === "string" &&
    typeof entry.title === "string" &&
    (entry.kind === undefined || entry.kind === "todo" || entry.kind === "log")
  );
};

// ---- IndexedDB ------------------------------------------------------------
const DB_NAME = "rhine-terminal";
const STORE = "entries";

let handle: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  handle ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" }).createIndex("date", "date");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return handle;
}

function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = body(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export const listEntries = (): Promise<Entry[]> =>
  run<Entry[]>("readonly", (store) => store.getAll() as IDBRequest<Entry[]>).then((rows) =>
    sortEntries(rows.filter(isEntry)),
  );

export const saveEntry = (entry: Entry): Promise<void> =>
  run("readwrite", (store) => store.put(entry)).then(() => undefined);

export const removeEntry = (id: string): Promise<void> =>
  run("readwrite", (store) => store.delete(id)).then(() => undefined);

export async function replaceEntries(entries: Entry[]): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    store.clear();
    for (const entry of entries) store.put(entry);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
