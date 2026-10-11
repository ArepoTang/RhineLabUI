import { dayKey } from "./workbench-state.ts";
import { renderMarkdown } from "./markdown.ts";
import {
  entriesOn,
  entryKind,
  entryTitle,
  exportedEntries,
  isLog,
  isReport,
  isTodo,
  listEntries,
  logLocked,
  logOn,
  monthGrid,
  monthLabel,
  reportOn,
  saveEntry,
  searchEntries,
  type Entry,
  type EntryKind,
} from "./entries.ts";
import { anchoredPeriod, periodRange, periodScope, periodTitle, scopeName, lastWeekPeriod, type ReportScope } from "./reports.ts";

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
  /** 填了服务商 key 才在工具栏显示静默状态位（没填就什么都不显示）。 */
  reportConfigured: boolean;
  /** 正在后台生成某一期：状态位变描边。 */
  reportBusy: boolean;
};

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** 格子本身只显示日期：小圆点=有待办，方块=有日志，三角=有报告；无障碍名称里保留条数。 */
const dayMeta = (day: string, todos: number, log: boolean, report = false) => {
  const weekday = (new Date(`${day}T00:00:00`).getDay() + 6) % 7;
  const kinds = [todos ? `${todos} 条待办` : "", log ? "有日志" : "", report ? "有报告" : ""].filter(Boolean).join("，");
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
  if (isReport(entry))
    return `<div class="entry-row" data-kind="report"><span class="entry-check entry-report-glyph" aria-hidden="true">▲</span><button class="entry-open" data-entry-open="${entry.id}"><strong>${title}</strong>${meta ? `<small>${escape(meta)}</small>` : ""}</button></div>`;
  if (isLog(entry))
    return `<div class="entry-row" data-kind="log"><span class="entry-check entry-log-glyph" aria-hidden="true">▤</span><button class="entry-open" data-entry-open="${entry.id}"><strong>${title}</strong>${meta ? `<small>${escape(meta)}</small>` : ""}</button></div>`;
  return `<div class="entry-row" data-done="${entry.done}"><button class="entry-check" data-entry-toggle="${entry.id}" aria-pressed="${entry.done}" aria-label="标记完成"><span aria-hidden="true">${entry.done ? "✓" : ""}</span></button><button class="entry-open" data-entry-open="${entry.id}"><strong>${title}</strong>${meta ? `<small>${escape(meta)}</small>` : ""}</button></div>`;
}

/** 报告条目：周期名当标题，正文是模型输出（或粘回来的）。 */
function reportRowMarkup(entry: Entry): string {
  const preview = entry.body.trim().split("\n").find((line) => line.trim() && !line.startsWith("#")) ?? "";
  return `<div class="entry-row" data-kind="report"><span class="entry-check entry-report-glyph" aria-hidden="true">▲</span><button class="entry-open" data-entry-open="${entry.id}"><strong>${escape(entryTitle(entry, entry.period ?? "报告"))}</strong>${preview ? `<small>${escape(preview.slice(0, 60))}</small>` : ""}</button></div>`;
}

/** 在日历选中日里显示的报告：本期期末日落在这一天。 */
function dayReportMarkup(entries: Entry[], day: string): string {
  const reports = entries.filter((entry) => isReport(entry) && entry.date === day);
  if (!reports.length) return "";
  return `<div class="entry-list-head"><span>报告</span><span>${reports.length} 份</span></div>${reports.map(reportRowMarkup).join("")}`;
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
  return `<article class="entry-log" data-locked="${locked}"><div class="entry-log-body markdown">${renderMarkdown(entry.body) || "（空）"}</div>${locked ? '<span class="entry-log-note">只读</span>' : `<button class="entry-edit" data-entry-log="${day}">编辑日志</button>`}</article>`;
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
  const reportDays = new Set<string>();
  for (const entry of board.entries) {
    if (isLog(entry)) logDays.add(entry.date);
    else if (isReport(entry)) reportDays.add(entry.date);
    else todoCounts.set(entry.date, (todoCounts.get(entry.date) ?? 0) + 1);
  }
  const today = board.today;
  const days = monthGrid(year, month)
    .map((day) => {
      const todos = todoCounts.get(day) ?? 0;
      const marks =
        (todos ? '<i class="entry-mark entry-mark-todo" aria-hidden="true"></i>' : "") +
        (logDays.has(day) ? '<i class="entry-mark entry-mark-log" aria-hidden="true"></i>' : "") +
        (reportDays.has(day) ? '<i class="entry-mark entry-mark-report" aria-hidden="true"></i>' : "");
      return `<button class="entry-day" data-entry-day="${day}" aria-pressed="${day === board.selectedDay}" aria-label="${dayMeta(day, todos, logDays.has(day), reportDays.has(day))}"${day.startsWith(prefix) ? "" : ' data-outside="true"'}${day === today ? ' data-today="true"' : ""}><span>${Number(day.slice(8))}</span>${marks ? `<span class="entry-marks">${marks}</span>` : ""}</button>`;
    })
    .join("");
  const todos = entriesOn(board.entries, board.selectedDay).filter(isTodo);
  const log = logOn(board.entries, board.selectedDay);
  return `<div class="entry-month"><button data-entry-month="-1" aria-label="上个月">←</button><strong>${monthLabel(year, month)}</strong><button data-entry-month="1" aria-label="下个月">→</button><button data-entry-today ${board.selectedDay === today ? "disabled" : ""}>今天</button></div><div class="entry-week">${WEEKDAYS.map((day) => `<span>${day}</span>`).join("")}</div><div class="entry-grid">${days}</div><div class="entry-list-head"><span>待办 · ${dayLabel(board.selectedDay)}</span><span>${todos.length} 条</span></div><div class="entry-list">${todos.length ? todos.map((entry) => rowMarkup(entry)).join("") : '<p class="entry-empty">这一天没有待办。</p>'}</div><button class="entry-new" data-entry-new="${board.selectedDay}">＋ 新建待办</button><div class="entry-list-head"><span>日志</span></div>${logMarkup(log, board.selectedDay, today)}${dayReportMarkup(board.entries, board.selectedDay)}`;
}

/** 几何状态位：实心=已完成、空心=缺失、生成中=逐段描边。不带文字，也不是按钮。 */
const glyph = (state: "done" | "missing" | "busy") => `<i class="report-glyph" data-state="${state}" aria-hidden="true"></i>`;
export const reportGlyph = (entries: Entry[], period: string, busy = false) =>
  glyph(busy ? "busy" : reportOn(entries, period) ? "done" : "missing");

const SCOPE_BUTTONS: { label: string; scope: ReportScope; back: number }[] = [
  { label: "本周", scope: "week", back: 0 },
  { label: "上周", scope: "week", back: 1 },
  { label: "本月", scope: "month", back: 0 },
  { label: "上月", scope: "month", back: 1 },
  { label: "本年", scope: "year", back: 0 },
  { label: "去年", scope: "year", back: 1 },
];

export type ReportManualView = {
  period: string;
  existing: Entry | undefined;
  /** 本机时间的今天：周期按钮靠它算出各自的周期键，决定哪一个高亮。 */
  today: string;
  /** 后台任务状态：生成中 / 失败 / 空闲。空的时候只显示按钮。 */
  run?: { busy: boolean; status: string };
};

/**
 * 手动档（设置里）：选周期 → 复制拼好的提示词 → 把模型输出粘回来存成报告。
 * 没填 key 的走这条路；填了 key 的走自动生成，这里仍然可用（改周期重做）。
 */
export function reportManualMarkup(view: ReportManualView): string {
  const { period, existing, today } = view;
  const run = view.run ?? { busy: false, status: "" };
  const { from, to } = periodRange(period);
  const scope = periodScope(period);
  const buttons = SCOPE_BUTTONS.map(
    (item) => `<button data-report-scope="${item.scope}" data-report-back="${item.back}"${anchoredPeriod(item.scope, item.back, today) === period ? ' data-active="true"' : ""}>${item.label}</button>`,
  ).join("");
  const preview = existing ? renderMarkdown(existing.body) : "";
  return `<div class="report-manual"><div class="report-scopes">${buttons}</div><p class="report-head">${glyph(existing ? "done" : "missing")}<strong>${periodTitle(period)}</strong><span>${scopeName(scope)} · ${from} 至 ${to}</span></p><div class="report-run">${run.busy ? '<button data-action="cancel-reports">取消</button>' : '<button data-action="backfill-reports">补全缺口</button>'}<span>${escape(run.status)}</span></div><div class="report-actions"><button data-action="copy-prompt" class="report-primary">复制提示词</button></div><label class="entry-field report-paste"><span>把模型输出粘到这里</span><textarea id="report-paste" rows="8" placeholder="## Summary…"></textarea></label><div class="report-actions"><button data-action="save-pasted-report">存为报告</button></div>${existing ? `<p class="entry-empty">这一期已经有报告（${existing.date}）。</p><div class="report-preview markdown">${preview}</div>` : '<p class="entry-empty">这一期还没有报告。</p>'}</div>`;
}

export function entriesMarkup(board: BoardView): string {
  // 导出相关的计数只看日志与报告（不含待办）。
  const total = exportedEntries(board.entries).length;
  // 填了 key 才显示：它只是静默生成的进度指示，不是按钮。
  const state = board.reportConfigured
    ? `<span class="entry-report-state">${reportGlyph(board.entries, lastWeekPeriod(board.today), board.reportBusy)}</span>`
    : "";
  return `<h2>ENTRIES<small>待办与日志</small></h2><div class="entry-toolbar"><div class="entry-search"><span aria-hidden="true">⌕</span><input id="entry-search" type="search" autocomplete="off" placeholder="搜索全部条目：待办、日志、日期" aria-label="搜索条目" value="${escape(board.query)}"/></div>${state}<button class="entry-export" data-action="export-logs"${total ? "" : " disabled"}>导出档案库${total ? ` <span>${total}</span>` : ""}</button></div>${board.error ? `<p class="entry-error">${escape(board.error)}</p>` : ""}<div id="entry-body">${boardBodyMarkup(board)}</div>`;
}

/**
 * 编辑弹窗。待办：日期、时间、标题、正文；日志：只有正文，日期就是当天。
 * 过日只读的日志不会走到这里（列表里只给只读正文）。
 */

/** 图标一律内联 SVG（和品牌标志同一路子），不引图标库；文字只留在 aria-label / title 里。 */
const ICON = (paths: string) => `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${paths}</svg>`;

/**
 * 全屏 Markdown 编辑器：正文/预览两个窗格。
 * 插入工具的按钮不在这里 —— 它们在键盘配件栏里（markdownBarMarkup），
 * 因为手机上它必须贴着键盘，而弹窗在过渡时会带 transform，fixed 元素会被它带走。
 */
function markdownEditorMarkup(body: string, rows = 14): string {
  return `<div class="md-editor" data-view="edit"><div class="md-panes"><div class="md-pane md-pane-edit"><textarea id="entry-body-field" aria-label="正文（Markdown）" rows="${rows}" spellcheck="false">${escape(body)}</textarea></div><div class="md-pane md-pane-preview markdown" id="entry-body-preview" aria-label="预览">${renderMarkdown(body)}</div></div></div>`;
}

export function editorMarkup(
  entry: Entry | undefined,
  date: string,
  kind: EntryKind = "todo",
): string {
  const format = entry ? entryKind(entry) : kind;
  if (format === "report") {
    const period = entry?.period ?? "";
    const { from, to } = periodRange(period || "1970-01-01");
    return `<h2>${entry ? "EDIT REPORT" : "NEW REPORT"}<small>${entry ? "编辑报告" : "报告"}</small></h2><p class="settings-intro">${period ? `${periodTitle(period)} · ${from} 至 ${to}` : "未选定周期"}<button type="button" class="md-view" data-action="editor-view" aria-label="预览" title="预览">${ICON('<path d="M1.8 8S4 3.5 8 3.5 14.2 8 14.2 8 12 12.5 8 12.5 1.8 8 1.8 8Z"/><circle cx="8" cy="8" r="2"/>')}</button></p>${markdownEditorMarkup(entry?.body ?? "", 18)}<div class="entry-actions">${entry ? '<button data-action="delete-entry" class="entry-delete">删除</button>' : ""}<button data-action="save-entry" class="entry-save">保存 <span>↗</span></button></div>`;
  }
  if (format === "log")
    return `<h2>${entry ? "EDIT LOG" : "NEW LOG"}<small>${entry ? "编辑日志" : "写日志"}</small></h2><p class="settings-intro">${date}<button type="button" class="md-view" data-action="editor-view" aria-label="预览" title="预览">${ICON('<path d="M1.8 8S4 3.5 8 3.5 14.2 8 14.2 8 12 12.5 8 12.5 1.8 8 1.8 8Z"/><circle cx="8" cy="8" r="2"/>')}</button></p>${markdownEditorMarkup(entry?.body ?? "", 16)}<div class="entry-actions"><button data-action="save-entry" class="entry-save">保存 <span>↗</span></button></div>`;
  const value = entry?.date ?? date;
  return `<h2>${entry ? "EDIT ENTRY" : "NEW ENTRY"}<small>${entry ? "编辑待办" : "新建待办"}</small></h2><div class="entry-fields"><label class="entry-field"><span>日期</span><input type="date" id="entry-date" value="${value}"/></label><label class="entry-field"><span>时间（可选）</span><input type="time" id="entry-time" value="${entry?.time ?? ""}"/></label><label class="entry-field"><span>标题（可选）</span><input type="text" id="entry-title" maxlength="80" value="${escape(entry?.title ?? "")}"/></label><label class="entry-field entry-body-field"><span>正文（Markdown）</span><textarea id="entry-body-field" rows="10">${escape(entry?.body ?? "")}</textarea></label></div><div class="entry-actions">${entry ? '<button data-action="delete-entry" class="entry-delete">删除</button>' : ""}<button data-action="save-entry" class="entry-save">保存 <span>↗</span></button></div>`;
}

export class EntriesBoard implements BoardView {
  entries: Entry[] = [];
  selectedDay = dayKey(new Date());
  monthAnchor = new Date();
  query = "";
  error = "";
  /** 填了服务商 key 才有静默状态位；它反映的是最近一个过完的周。 */
  reportConfigured = false;
  reportBusy = false;

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
    if (!entry || entryKind(entry) !== "todo") return;
    try {
      await saveEntry({ ...entry, done: !entry.done, updated: Date.now() });
    } catch {
      this.error = "本机存储不可用，条目无法读取或保存。";
    }
    await this.load();
  }
}
