import { dayKey } from "./workbench-state.ts";
import {
  entriesOn,
  entryTitle,
  listEntries,
  monthGrid,
  monthLabel,
  saveEntry,
  searchEntries,
  type Entry,
} from "./entries.ts";

/**
 * 网页版的日历与笔记界面。
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
  monthAnchor: Date;
  query: string;
  error: string;
};

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** 格子本身只显示日期，条数用一个小圆点表示；无障碍名称里保留条数。 */
const dayMeta = (day: string, count: number) => {
  const weekday = (new Date(`${day}T00:00:00`).getDay() + 6) % 7;
  return `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8))} 日 周${WEEKDAYS[weekday]}${count ? `，${count} 条` : ""}`;
};

const dayLabel = (day: string) => {
  const [, month, date] = day.split("-");
  const weekday = new Date(`${day}T00:00:00`).getDay();
  return `${Number(month)} 月 ${Number(date)} 日 · 周${WEEKDAYS[(weekday + 6) % 7]}`;
};

function rowMarkup(entry: Entry, showDate = false): string {
  const title = escape(entryTitle(entry));
  const preview = entry.body.trim().split("\n")[0].replace(/^#+\s*/, "");
  const meta = [showDate ? entry.date : "", entry.time, preview.slice(0, 60)]
    .filter(Boolean)
    .join(" · ");
  return `<div class="entry-row" data-done="${entry.done}"><button class="entry-check" data-entry-toggle="${entry.id}" aria-pressed="${entry.done}" aria-label="标记完成"><span aria-hidden="true">${entry.done ? "✓" : ""}</span></button><button class="entry-open" data-entry-open="${entry.id}"><strong>${title}</strong>${meta ? `<small>${escape(meta)}</small>` : ""}</button></div>`;
}

export function boardBodyMarkup(board: BoardView): string {
  if (board.query.trim()) {
    const found = searchEntries(board.entries, board.query);
    return `<div class="entry-list-head"><span>搜索 · ${escape(board.query.trim())}</span><span>${found.length} 条</span></div><div class="entry-list">${found.length ? found.map((entry) => rowMarkup(entry, true)).join("") : '<p class="entry-empty">没有匹配的条目。</p>'}</div>`;
  }
  const year = board.monthAnchor.getFullYear();
  const month = board.monthAnchor.getMonth();
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const counts = new Map<string, number>();
  for (const entry of board.entries) counts.set(entry.date, (counts.get(entry.date) ?? 0) + 1);
  const today = dayKey(new Date());
  const days = monthGrid(year, month)
    .map((day) => {
      const count = counts.get(day) ?? 0;
      return `<button class="entry-day" data-entry-day="${day}" aria-pressed="${day === board.selectedDay}" aria-label="${dayMeta(day, count)}"${day.startsWith(prefix) ? "" : ' data-outside="true"'}${day === today ? ' data-today="true"' : ""}><span>${Number(day.slice(8))}</span>${count ? '<i aria-hidden="true"></i>' : ""}</button>`;
    })
    .join("");
  const list = entriesOn(board.entries, board.selectedDay);
  return `<div class="entry-month"><button data-entry-month="-1" aria-label="上个月">←</button><strong>${monthLabel(year, month)}</strong><button data-entry-month="1" aria-label="下个月">→</button><button data-entry-today ${board.selectedDay === today ? "disabled" : ""}>今天</button></div><div class="entry-week">${WEEKDAYS.map((day) => `<span>${day}</span>`).join("")}</div><div class="entry-grid">${days}</div><div class="entry-list-head"><span>${dayLabel(board.selectedDay)}</span><span>${list.length} 条</span></div><div class="entry-list">${list.length ? list.map((entry) => rowMarkup(entry)).join("") : '<p class="entry-empty">这一天还没有条目。</p>'}</div><button class="entry-new" data-entry-new="${board.selectedDay}">＋ 在这一天新建</button>`;
}

export function entriesMarkup(board: BoardView): string {
  return `<h2>ENTRIES<small>日历与笔记</small></h2><div class="entry-search"><span aria-hidden="true">⌕</span><input id="entry-search" type="search" autocomplete="off" placeholder="搜索全部条目：标题、正文、日期" aria-label="搜索条目" value="${escape(board.query)}"/></div>${board.error ? `<p class="entry-error">${escape(board.error)}</p>` : ""}<div id="entry-body">${boardBodyMarkup(board)}</div><div class="modal-bottom"><span>MARKDOWN · 本机存储</span><span>POWERED BY RHINE LAB</span></div>`;
}

/** 编辑弹窗。日期与时间用原生控件，正文按 Markdown 纯文本对待。 */
export function editorMarkup(entry: Entry | undefined, date: string): string {
  const value = entry?.date ?? date;
  return `<h2>${entry ? "EDIT ENTRY" : "NEW ENTRY"}<small>${entry ? "编辑条目" : "新建条目"}</small></h2><p class="settings-intro">条目可以只是笔记，也可以写成日程</p><div class="entry-fields"><label class="entry-field"><span>日期</span><input type="date" id="entry-date" value="${value}"/></label><label class="entry-field"><span>时间（可选）</span><input type="time" id="entry-time" value="${entry?.time ?? ""}"/></label><label class="entry-field"><span>标题（可选）</span><input type="text" id="entry-title" maxlength="80" value="${escape(entry?.title ?? "")}"/></label><label class="entry-field entry-body-field"><span>正文（Markdown）</span><textarea id="entry-body-field" rows="10">${escape(entry?.body ?? "")}</textarea></label></div><div class="entry-actions">${entry ? '<button data-action="delete-entry" class="entry-delete">删除</button>' : ""}<button data-action="save-entry" class="entry-save">保存 <span>↗</span></button></div>`;
}

export class EntriesBoard implements BoardView {
  entries: Entry[] = [];
  selectedDay = dayKey(new Date());
  monthAnchor = new Date();
  query = "";
  error = "";

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
    if (!entry) return;
    try {
      await saveEntry({ ...entry, done: !entry.done, updated: Date.now() });
    } catch {
      this.error = "本机存储不可用，条目无法读取或保存。";
    }
    await this.load();
  }
}
