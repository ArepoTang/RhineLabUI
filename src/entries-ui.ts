import { dayKey } from "./workbench-state.ts";
import {
  entriesOn,
  entryKind,
  entryTitle,
  isLog,
  listEntries,
  logLocked,
  logOn,
  monthGrid,
  monthLabel,
  saveEntry,
  searchEntries,
  type Entry,
  type EntryKind,
} from "./entries.ts";

/**
 * 网页版的日历：一天两种格式 —— 待办（多条，随便改）与日志（一条，过日只读）。
 *
 * 上游明确把「工作台」限定在 wallpaper 构建（AGENTS.md：工作台、系统音频／媒体、
 * HUD 属性、自定义图片与 3D 卸载入口仍仅在 wallpaper 构建启用），所以日历不能长在
 * 工作台里，这里是网页版自己的一个界面，通过应用的 #modal-root 弹窗承载 ——
 * 软键盘、窄屏、返回手势、焦点回收都由那套现成的状态机负责。
 *
 * 这个模块只有状态与 HTML 生成，事件仍由 main.ts 的委派处理；这样 markup 是状态的
 * 纯函数，可以在 Node 里断言（见 scripts/check-entries.mjs）。
 */
export type BoardView = {
  entries: Entry[];
  selectedDay: string;
  /** 本机时间的今天：日志的只读边界，每次取用都重新算，跨零点不用刷新。 */
  readonly today: string;
  monthAnchor: Date;
  query: string;
  error: string;
};

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** 格子本身只显示日期：小圆点=有待办，方块=有日志；无障碍名称里保留条数。 */
const dayMeta = (day: string, todos: number, log: boolean) => {
  const weekday = (new Date(`${day}T00:00:00`).getDay() + 6) % 7;
  const kinds = [todos ? `${todos} 条待办` : "", log ? "有日志" : ""].filter(Boolean).join("，");
  return `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8))} 日 周${WEEKDAYS[weekday]}${kinds ? `，${kinds}` : ""}`;
};

const dayLabel = (day: string) => {
  const [, month, date] = day.split("-");
  const weekday = new Date(`${day}T00:00:00`).getDay();
  return `${Number(month)} 月 ${Number(date)} 日 · 周${WEEKDAYS[(weekday + 6) % 7]}`;
};

function rowMarkup(entry: Entry, showDate = false): string {
  const title = escape(entryTitle(entry));
  const preview = entry.body.trim().split("\n")[0].replace(/^#+\s*/, "");
  const meta = [showDate ? entry.date : "", isLog(entry) ? "日志" : entry.time, preview.slice(0, 60)]
    .filter(Boolean)
    .join(" · ");
  if (isLog(entry))
    return `<div class="entry-row" data-kind="log"><span class="entry-check entry-log-glyph" aria-hidden="true">▤</span><button class="entry-open" data-entry-open="${entry.id}"><strong>${title}</strong>${meta ? `<small>${escape(meta)}</small>` : ""}</button></div>`;
  return `<div class="entry-row" data-done="${entry.done}"><button class="entry-check" data-entry-toggle="${entry.id}" aria-pressed="${entry.done}" aria-label="标记完成"><span aria-hidden="true">${entry.done ? "✓" : ""}</span></button><button class="entry-open" data-entry-open="${entry.id}"><strong>${title}</strong>${meta ? `<small>${escape(meta)}</small>` : ""}</button></div>`;
}

/**
 * 日志块：本日的可编辑，过日的只读（连删除入口都不给）。
 * 只给今天写 —— 未来日期要么是还没到，要么是事后补，两种都会破坏"当天写当天"的记录意义。
 */
function logMarkup(entry: Entry | undefined, day: string, today: string): string {
  if (!entry) {
    if (day === today) return `<button class="entry-new" data-entry-log="${day}">写今天的日志</button>`;
    return `<p class="entry-empty">${day < today ? "这一天没有日志。" : "还没到这一天。"}</p>`;
  }
  const locked = logLocked(entry, today);
  return `<article class="entry-log" data-locked="${locked}"><div class="entry-log-body">${escape(entry.body) || "（空）"}</div>${locked ? '<span class="entry-log-note">只读</span>' : `<button class="entry-edit" data-entry-log="${day}">编辑日志</button>`}</article>`;
}

export function boardBodyMarkup(board: BoardView): string {
  if (board.query.trim()) {
    const found = searchEntries(board.entries, board.query);
    return `<div class="entry-list-head"><span>搜索 · ${escape(board.query.trim())}</span><span>${found.length} 条</span></div><div class="entry-list">${found.length ? found.map((entry) => rowMarkup(entry, true)).join("") : '<p class="entry-empty">没有匹配的条目。</p>'}</div>`;
  }
  const year = board.monthAnchor.getFullYear();
  const month = board.monthAnchor.getMonth();
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const todoCounts = new Map<string, number>();
  const logDays = new Set<string>();
  for (const entry of board.entries) {
    if (isLog(entry)) logDays.add(entry.date);
    else todoCounts.set(entry.date, (todoCounts.get(entry.date) ?? 0) + 1);
  }
  const today = board.today;
  const days = monthGrid(year, month)
    .map((day) => {
      const todos = todoCounts.get(day) ?? 0;
      const marks =
        (todos ? '<i class="entry-mark entry-mark-todo" aria-hidden="true"></i>' : "") +
        (logDays.has(day) ? '<i class="entry-mark entry-mark-log" aria-hidden="true"></i>' : "");
      return `<button class="entry-day" data-entry-day="${day}" aria-pressed="${day === board.selectedDay}" aria-label="${dayMeta(day, todos, logDays.has(day))}"${day.startsWith(prefix) ? "" : ' data-outside="true"'}${day === today ? ' data-today="true"' : ""}><span>${Number(day.slice(8))}</span>${marks ? `<span class="entry-marks">${marks}</span>` : ""}</button>`;
    })
    .join("");
  const todos = entriesOn(board.entries, board.selectedDay).filter((entry) => !isLog(entry));
  const log = logOn(board.entries, board.selectedDay);
  return `<div class="entry-month"><button data-entry-month="-1" aria-label="上个月">←</button><strong>${monthLabel(year, month)}</strong><button data-entry-month="1" aria-label="下个月">→</button><button data-entry-today ${board.selectedDay === today ? "disabled" : ""}>今天</button></div><div class="entry-week">${WEEKDAYS.map((day) => `<span>${day}</span>`).join("")}</div><div class="entry-grid">${days}</div><div class="entry-list-head"><span>待办 · ${dayLabel(board.selectedDay)}</span><span>${todos.length} 条</span></div><div class="entry-list">${todos.length ? todos.map((entry) => rowMarkup(entry)).join("") : '<p class="entry-empty">这一天没有待办。</p>'}</div><button class="entry-new" data-entry-new="${board.selectedDay}">＋ 新建待办</button><div class="entry-list-head"><span>日志</span></div>${logMarkup(log, board.selectedDay, today)}`;
}

export function entriesMarkup(board: BoardView): string {
  const logs = board.entries.filter(isLog).length;
  return `<h2>ENTRIES<small>待办与日志</small></h2><div class="entry-toolbar"><div class="entry-search"><span aria-hidden="true">⌕</span><input id="entry-search" type="search" autocomplete="off" placeholder="搜索全部条目：待办、日志、日期" aria-label="搜索条目" value="${escape(board.query)}"/></div><button class="entry-export" data-action="export-logs"${logs ? "" : " disabled"}>导出日志${logs ? ` <span>${logs}</span>` : ""}</button></div>${board.error ? `<p class="entry-error">${escape(board.error)}</p>` : ""}<div id="entry-body">${boardBodyMarkup(board)}</div>`;
}

/**
 * 编辑弹窗。待办：日期、时间、标题、正文；日志：只有正文，日期就是当天。
 * 过日只读的日志不会走到这里（列表里只给只读正文）。
 */
export function editorMarkup(
  entry: Entry | undefined,
  date: string,
  kind: EntryKind = "todo",
): string {
  const format = entry ? entryKind(entry) : kind;
  if (format === "log")
    return `<h2>${entry ? "EDIT LOG" : "NEW LOG"}<small>${entry ? "编辑日志" : "写日志"}</small></h2><p class="settings-intro">${date}</p><div class="entry-fields"><label class="entry-field entry-body-field"><span>正文（Markdown）</span><textarea id="entry-body-field" rows="14">${escape(entry?.body ?? "")}</textarea></label></div><div class="entry-actions"><button data-action="save-entry" class="entry-save">保存 <span>↗</span></button></div>`;
  const value = entry?.date ?? date;
  return `<h2>${entry ? "EDIT ENTRY" : "NEW ENTRY"}<small>${entry ? "编辑待办" : "新建待办"}</small></h2><p class="settings-intro">待办可以是一句话，也可以是带时间的安排；时间留空就是全天</p><div class="entry-fields"><label class="entry-field"><span>日期</span><input type="date" id="entry-date" value="${value}"/></label><label class="entry-field"><span>时间（可选）</span><input type="time" id="entry-time" value="${entry?.time ?? ""}"/></label><label class="entry-field"><span>标题（可选）</span><input type="text" id="entry-title" maxlength="80" value="${escape(entry?.title ?? "")}"/></label><label class="entry-field entry-body-field"><span>正文（Markdown）</span><textarea id="entry-body-field" rows="10">${escape(entry?.body ?? "")}</textarea></label></div><div class="entry-actions">${entry ? '<button data-action="delete-entry" class="entry-delete">删除</button>' : ""}<button data-action="save-entry" class="entry-save">保存 <span>↗</span></button></div>`;
}

export class EntriesBoard implements BoardView {
  entries: Entry[] = [];
  selectedDay = dayKey(new Date());
  monthAnchor = new Date();
  query = "";
  error = "";

  get today() {
    return dayKey(new Date());
  }

  async load(): Promise<void> {
    try {
      this.entries = await listEntries();
      this.error = "";
    } catch {
      this.entries = [];
      this.error = "本机存储不可用，条目无法读取或保存。";
    }
  }

  entry(id: string) { return this.entries.find((item) => item.id === id); }

  selectDay(day: string) {
    this.selectedDay = day;
    const [year, month] = day.split("-").map(Number);
    this.monthAnchor = new Date(year, month - 1, 1);
  }

  shiftMonth(delta: number) {
    this.monthAnchor = new Date(this.monthAnchor.getFullYear(), this.monthAnchor.getMonth() + delta, 1);
  }

  async toggle(id: string) {
    const entry = this.entry(id);
    if (!entry || isLog(entry)) return;
    try {
      await saveEntry({ ...entry, done: !entry.done, updated: Date.now() });
    } catch {
      this.error = "本机存储不可用，条目无法读取或保存。";
    }
    await this.load();
  }
}
