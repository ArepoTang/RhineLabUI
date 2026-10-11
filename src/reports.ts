import {
  entryTitle,
  isLog,
  isTodo,
  reportOn,
  reportsIn,
  sortEntries,
  type Entry,
} from "./entries.ts";

/**
 * 报告的全部纯逻辑：周期数学、原料挑选、统计、提示词拼接。
 *
 * 这里没有任何网络与 DOM —— 生成报告的流程、无 key 时的「复制提示词」路径、
 * 以及统计数字都走同一份代码，所以可以在 Node 里断言（scripts/check-reports.mjs）。
 * 数字统计必须在这里算：让模型自己数条数、字数、最常在几点写，它一定会编。
 */

export type ReportScope = "week" | "month" | "year";
export type PromptKey = "system" | ReportScope;

// ---- 周期 -----------------------------------------------------------------

const DAY_MS = 86_400_000;
const asDay = (time: number) => new Date(time).toISOString().slice(0, 10);
const atDay = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** 该日所属的 ISO 周（周一开始，周四决定年份）。 */
export const shiftDay = (day: string, days: number) => asDay(atDay(day) + days * DAY_MS);

function isoWeek(day: string): { year: number; week: number } {
  const date = new Date(atDay(day));
  date.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
  const year = date.getUTCFullYear();
  const first = new Date(`${year}-01-04T00:00:00Z`);
  first.setUTCDate(first.getUTCDate() + 3 - ((first.getUTCDay() + 6) % 7));
  return { year, week: 1 + Math.round((date.getTime() - first.getTime()) / (7 * DAY_MS)) };
}

export const weekPeriod = (day: string) => {
  const { year, week } = isoWeek(day);
  return `${year}-W${String(week).padStart(2, "0")}`;
};
export const monthPeriod = (day: string) => day.slice(0, 7);
export const yearPeriod = (day: string) => day.slice(0, 4);

export const periodScope = (period: string): ReportScope =>
  period.includes("-W") ? "week" : period.length === 7 ? "month" : "year";

/** 周期覆盖的日期区间（含两端）。 */
export function periodRange(period: string): { from: string; to: string } {
  const scope = periodScope(period);
  if (scope === "week") {
    const [year, week] = [Number(period.slice(0, 4)), Number(period.slice(6))];
    const thursday = new Date(`${year}-01-04T00:00:00Z`);
    thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7) + (week - 1) * 7);
    return { from: asDay(thursday.getTime() - 3 * DAY_MS), to: asDay(thursday.getTime() + 3 * DAY_MS) };
  }
  if (scope === "month") {
    const [year, month] = [Number(period.slice(0, 4)), Number(period.slice(5, 7))];
    const last = new Date(Date.UTC(year, month, 0));
    return { from: `${period}-01`, to: asDay(last.getTime()) };
  }
  return { from: `${period}-01-01`, to: `${period}-12-31` };
}

export const previousPeriod = (period: string) => {
  const scope = periodScope(period);
  const { from } = periodRange(period);
  if (scope === "week") return weekPeriod(asDay(atDay(from) - 7 * DAY_MS));
  if (scope === "month") {
    const [year, month] = [Number(period.slice(0, 4)), Number(period.slice(5, 7))];
    return monthPeriod(month === 1 ? `${year - 1}-12-01` : `${year}-${String(month - 1).padStart(2, "0")}-01`);
  }
  return String(Number(period) - 1);
};

/** 上级周期的下级周期：月 → 该月出现过的每一周（去重、按时间），年 → 12 个月。 */
export function subPeriods(period: string): string[] {
  const scope = periodScope(period);
  if (scope === "year") {
    return Array.from({ length: 12 }, (_, index) => `${period}-${String(index + 1).padStart(2, "0")}`);
  }
  if (scope === "month") {
    const { from, to } = periodRange(period);
    const found: string[] = [];
    for (let time = atDay(from); time <= atDay(to); time += DAY_MS) {
      const week = weekPeriod(asDay(time));
      if (!found.includes(week)) found.push(week);
    }
    return found;
  }
  return [];
}

export const periodTitle = (period: string) => {
  const scope = periodScope(period);
  if (scope === "week") return `${period.slice(0, 4)} 年第 ${Number(period.slice(6))} 周`;
  if (scope === "month") return `${period.slice(0, 4)} 年 ${Number(period.slice(5, 7))} 月`;
  return `${period} 年`;
};

export const scopeName = (scope: ReportScope) => (scope === "week" ? "周报" : scope === "month" ? "月报" : "年报");

// ---- 原料 -----------------------------------------------------------------

const inRange = (entry: Entry, from: string, to: string) => entry.date >= from && entry.date <= to;

/** 本期原始日志与待办（下级报告不参与，它们单独走 subReports）。 */
export function periodMaterial(entries: Entry[], period: string) {
  const { from, to } = periodRange(period);
  const inside = sortEntries(entries.filter((entry) => inRange(entry, from, to)));
  return { from, to, logs: inside.filter(isLog), todos: inside.filter(isTodo) };
}

export function subReports(entries: Entry[], period: string): { period: string; entry: Entry }[] {
  return reportsIn(entries, subPeriods(period)).map((entry) => ({ period: entry.period ?? "", entry }));
}

/** 下级周期里还没有报告的（决定能不能生成上级，也用于提示缺口）。 */
export const missingSubPeriods = (entries: Entry[], period: string) =>
  subPeriods(period).filter((child) => !reportOn(entries, child));

/** 应收的最近若干期报告是否齐（几何状态位用：本期完成 / 缺失 / 生成中）。 */
export const reportState = (entries: Entry[], period: string): "done" | "missing" =>
  reportOn(entries, period) ? "done" : "missing";

export const nextPeriod = (period: string) => {
  const { to } = periodRange(period);
  if (periodScope(period) === "week") return weekPeriod(shiftDay(to, 1));
  if (periodScope(period) === "month") {
    const [year, month] = [Number(period.slice(0, 4)), Number(period.slice(5, 7))];
    return monthPeriod(month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`);
  }
  return String(Number(period) + 1);
};

/** 用于状态位与自动生成：最近一个已经过完的周。 */
export const lastWeekPeriod = (today: string) => previousPeriod(weekPeriod(today));

/** 手动档周期按钮的取值：scope + back 相对今天（本周/上周/本月/上月/本年/去年）。 */
export function anchoredPeriod(scope: ReportScope, back: number, today: string): string {
  if (scope === "week") return weekPeriod(shiftDay(today, -7 * back));
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - back];
  const anchor = new Date(Date.UTC(year, month, 1));
  return scope === "month"
    ? `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, "0")}`
    : String(year - back);
}

/** 没有日志也没有待办的期不值得生成（否则会在起始日志之前一直往前补空报告）。 */
const hasMaterial = (entries: Entry[], period: string) => {
  const { logs, todos } = periodMaterial(entries, period);
  return logs.length > 0 || todos.length > 0;
};

/**
 * 自动生成的下一期（静默补一期）：先补最近 8 周里最新的缺口，再轮到上月、去年。
 * 月/年必须等下级报告齐了才生成（口径见 canGenerate），所以不会用生料凑出月报。
 */
export function nextMissingPeriod(entries: Entry[], today: string): string | null {
  let week = lastWeekPeriod(today);
  for (let back = 0; back < 8; back += 1, week = previousPeriod(week)) {
    if (!reportOn(entries, week) && hasMaterial(entries, week)) return week;
  }
  for (const parent of [previousPeriod(monthPeriod(today)), previousPeriod(yearPeriod(today))]) {
    if (!reportOn(entries, parent) && hasMaterial(entries, parent) && canGenerate(entries, parent)) return parent;
  }
  return null;
}

/**
 * 积压的全部缺口（手动「补全缺口」用）：周 → 月 → 年，各自按时间升序。
 * 顺序就是依赖顺序：先有周报，月报才不用回落到生料。
 */
export function backlogPeriods(entries: Entry[], today: string, limit = 60): string[] {
  const days = entries.filter(isLog).map((entry) => entry.date).sort();
  if (!days.length) return [];
  const missing: string[] = [];
  const collect = (from: string, to: string, step: (period: string) => string) => {
    for (let period = from; period <= to && missing.length < limit; period = step(period)) {
      if (!reportOn(entries, period) && hasMaterial(entries, period)) missing.push(period);
    }
  };
  collect(weekPeriod(days[0]), lastWeekPeriod(today), nextPeriod);
  collect(monthPeriod(days[0]), previousPeriod(monthPeriod(today)), nextPeriod);
  collect(yearPeriod(days[0]), previousPeriod(yearPeriod(today)), nextPeriod);
  return missing.slice(0, limit);
}

// ---- 长期记忆 -------------------------------------------------------------

/** 各种写法都当同一件事实：去掉项目符、合并空白、大小写与全半角不管。 */
const normalizeFact = (line: string) =>
  line.replace(/^\s*(?:[-*+]|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim().toLowerCase();

const isNone = (fact: string) => /^(?:none|n\/a|-|无|没有|暂无|（无）|\(无\))$/i.test(fact.trim());

/** 从任意文本里取项目符：模型输出的「候选」和压缩结果都走这一个解析。 */
export function bulletLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/)?.[1] ?? "")
    .map((fact) => fact.replace(/[*_`]/g, "").trim())
    .filter((fact) => fact && !isNone(fact));
}

/** 报告正文里的「长期事实候选」段落（标题中英都认，到下一个标题为止）。 */
export function longTermFacts(report: string): string[] {
  const lines = report.split("\n");
  const start = lines.findIndex((line) => /^#{1,6}\s*(?:long[\s-]*term facts?|长期事实)/i.test(line.trim()));
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && /^#{1,6}\s/.test(line.trim()));
  return bulletLines(lines.slice(start + 1, end < 0 ? undefined : end).join("\n"));
}

/**
 * 只追加：已有的行不重复写（去重靠归一化比较，手改过的行不会被自动删）。
 * 追加是唯一不会丢东西的更新方式（重写要模型复述全文，一次失误就丢历史）。
 */
export function appendFacts(memory: string, facts: string[]): { text: string; added: string[] } {
  const seen = new Set(memory.split("\n").map(normalizeFact));
  const added: string[] = [];
  for (const fact of facts) {
    const key = normalizeFact(fact);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    added.push(fact);
  }
  if (!added.length) return { text: memory, added };
  const head = memory.trim();
  return { text: [...(head ? [head] : []), ...added.map((fact) => `- ${fact}`)].join("\n"), added };
}

/** 手动「压缩记忆」用的提示词：只让模型合并去重，不准新增事实。 */
export function compressPrompt(system: string, memory: string): { system: string; user: string } {
  return {
    system: system.trim() || defaultPrompts.system,
    user: [
      "TASK: compress the LONG-TERM FACTS below into at most 20 bullets.",
      "- Keep every distinct fact; merge duplicates and near-duplicates only.",
      "- Do NOT add facts, dates, names, or numbers that are not already there.",
      "- Do NOT drop a fact just to make the list shorter.",
      "OUTPUT: only the bullets, one per line, each starting with \"- \". No heading, no commentary, no code fences.",
      "LONG-TERM FACTS:",
      memory.trim() || "(none)",
    ].join("\n"),
  };
}

// ---- 统计（程序算，模型禁止重数） ----------------------------------------

export type PeriodStats = {
  days: number;
  logs: number;
  chars: number;
  longestLog: { date: string; chars: number } | null;
  busiestDay: { date: string; todos: number } | null;
  topHour: { hour: number; logs: number } | null;
  todos: { total: number; done: number };
  reports: { week: number; month: number; year: number };
};

export function periodStats(entries: Entry[], period: string): PeriodStats {
  const { from, to, logs, todos } = periodMaterial(entries, period);
  const longest = [...logs].sort((a, b) => b.body.trim().length - a.body.trim().length)[0];
  const hours = new Map<number, number>();
  for (const log of logs) {
    // 作息统计用 created（写日志那一刻）；日志只有当天能写，所以它不会混进补写。
    const hour = new Date(log.created).getHours();
    hours.set(hour, (hours.get(hour) ?? 0) + 1);
  }
  const top = [...hours.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const perDay = new Map<string, number>();
  for (const todo of todos) perDay.set(todo.date, (perDay.get(todo.date) ?? 0) + 1);
  const busiest = [...perDay.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const scope = periodScope(period);
  const inside = entries.filter((entry) => entry.date >= from && entry.date <= to);
  const countScope = (wanted: ReportScope) =>
    scope === "year" ? inside.filter((entry) => entry.period && periodScope(entry.period) === wanted).length : 0;
  return {
    days: new Set(logs.map((log) => log.date)).size,
    logs: logs.length,
    chars: logs.reduce((sum, log) => sum + log.body.trim().length, 0),
    longestLog: longest ? { date: longest.date, chars: longest.body.trim().length } : null,
    busiestDay: busiest ? { date: busiest[0], todos: busiest[1] } : null,
    topHour: top ? { hour: top[0], logs: top[1] } : null,
    todos: { total: todos.length, done: todos.filter((todo) => todo.done).length },
    reports: { week: countScope("week"), month: countScope("month"), year: countScope("year") },
  };
}

/** 年报用的权威数字块。模型被告知禁止重数。 */
export function statsBlock(stats: PeriodStats): string {
  const parts = [
    `${stats.logs} logs on ${stats.days} days`,
    `${stats.chars} characters`,
    stats.longestLog ? `longest log ${stats.longestLog.chars} chars on ${stats.longestLog.date}` : "",
    stats.busiestDay ? `busiest day ${stats.busiestDay.date} with ${stats.busiestDay.todos} todos` : "",
    stats.topHour ? `most active hour ${String(stats.topHour.hour).padStart(2, "0")}:00 (${stats.topHour.logs} logs)` : "",
    `todos closed ${stats.todos.done}/${stats.todos.total}`,
    `reports written ${stats.reports.week} weekly, ${stats.reports.month} monthly, ${stats.reports.year} yearly`,
  ];
  return parts.filter(Boolean).join(" · ");
}

// ---- 提示词 ---------------------------------------------------------------

export type ReportPrompts = Record<PromptKey, string>;

/** 默认提示词（英文，2026-10-10 与用户确认；输出跟随原料语言）。 */
export const defaultPrompts: ReportPrompts = {
  system: [
    "You are the report writer inside a personal terminal app. You compress raw daily logs into structured reports.",
    "Hard rules:",
    "- Use only facts present in the input. Never add, infer, or embellish anything. If a statement cannot be traced to a dated line in the input, omit it.",
    "- End every bullet with its source date as (MM-DD). The date must exist in the input.",
    "- No praise, no judgement of mood, productivity, or ability. No encouragement.",
    "- Omit empty sections. No filler sentences.",
    "- Output pure Markdown with no code fences. Write in the language of the input.",
  ].join("\n"),
  week: [
    "PERIOD: {{period}} ({{from}} .. {{to}})",
    "LONG-TERM FACTS:",
    "{{memory}}",
    "RAW LOGS:",
    "{{material}}",
    "TODOS:",
    "{{todos}}",
    "OUTPUT SECTIONS:",
    "## Summary          <=3 sentences, only what actually happened",
    "## Done             - ... (MM-DD)",
    "## Unfinished       - ...",
    "## Problems         only if the input states a problem",
    "## Long-term facts  stable facts worth remembering every period, else None",
  ].join("\n"),
  month: [
    "PERIOD: {{period}} ({{from}} .. {{to}})",
    "LONG-TERM FACTS:",
    "{{memory}}",
    "SUB-REPORTS (weekly reports of this period; use raw logs only for weeks without one):",
    "{{material}}",
    "TODOS:",
    "{{todos}}",
    "OUTPUT SECTIONS:",
    "## Summary          <=4 sentences, merge by theme, never restate week by week",
    "## Done             - ... (MM-DD)",
    "## Unfinished       - ...",
    "## Problems         only if the input states a problem",
    "## Long-term facts  stable facts worth remembering every period, else None",
  ].join("\n"),
  year: [
    "PERIOD: {{period}} ({{from}} .. {{to}})",
    "LONG-TERM FACTS:",
    "{{memory}}",
    "STATISTICS (authoritative numbers computed by the app; never recount or alter them):",
    "{{stats}}",
    "SUB-REPORTS (monthly reports of this period; use raw logs only for months without one):",
    "{{material}}",
    "TODOS:",
    "{{todos}}",
    "STYLE: you may use headline phrasing and one short narrative paragraph about this year, but every number must come from STATISTICS and every event from the input.",
    "OUTPUT SECTIONS:",
    "## This year        one short narrative paragraph, no praise",
    "## Highlights       - ... (MM-DD), pick the few things that actually happened",
    "## Numbers          - ... only from STATISTICS",
    "## Unfinished       - ...",
    "## Long-term facts  stable facts worth remembering every period, else None",
  ].join("\n"),
};

export const promptKeys: PromptKey[] = ["system", "week", "month", "year"];

/** 原料块：有下级报告就喂报告，缺哪一期才补那期的原始日志（报告链即记忆）。 */
function materialBlock(entries: Entry[], period: string): string {
  const scope = periodScope(period);
  const children = subReports(entries, period);
  const lines = children.map((child) => `### ${child.period}\n\n${child.entry.body.trim()}`);
  const { logs } = periodMaterial(entries, period);
  const raw = scope === "week"
    ? logs
    : (() => {
        const missing = new Set(missingSubPeriods(entries, period));
        // 月报的下级是周，年报的下级是月：缺哪一级就把那一段的日志补进来。
        return logs.filter((log) => missing.has(scope === "month" ? weekPeriod(log.date) : monthPeriod(log.date)));
      })();
  for (const log of raw) lines.push(`## ${log.date}\n\n${log.body.trim()}`);
  return lines.length ? lines.join("\n\n") : "(no records)";
}

function todoBlock(entries: Entry[], period: string): string {
  const { todos } = periodMaterial(entries, period);
  if (!todos.length) return "(none)";
  return todos
    .map((todo) => `- ${todo.date}${todo.time ? ` ${todo.time}` : ""} ${entryTitle(todo)} [${todo.done ? "done" : "open"}]`)
    .join("\n");
}

export type BuiltPrompt = { system: string; user: string; text: string };

/**
 * 拼一次请求的全部文本。无 key 的「复制提示词」与真正的调用共用它，
 * 所以你在设置里看到的、复制出去的、发出去的永远是同一份。
 */
export function buildPrompt(options: {
  entries: Entry[];
  period: string;
  memory: string;
  prompts: ReportPrompts;
}): BuiltPrompt {
  const { entries, period, memory, prompts } = options;
  const { from, to } = periodRange(period);
  const scope = periodScope(period);
  const filled = (prompts[scope] || defaultPrompts[scope])
    .replaceAll("{{period}}", period)
    .replaceAll("{{from}}", from)
    .replaceAll("{{to}}", to)
    .replaceAll("{{memory}}", memory.trim() || "None")
    .replaceAll("{{material}}", materialBlock(entries, period))
    .replaceAll("{{todos}}", todoBlock(entries, period))
    .replaceAll("{{stats}}", statsBlock(periodStats(entries, period)));
  const system = prompts.system.trim() || defaultPrompts.system;
  return {
    system,
    user: filled.trim(),
    text: `SYSTEM\n${system}\n\nUSER\n${filled.trim()}`,
  };
}

/** 缺的下级周期（月报缺周报、年报缺月报）要一起补：只有齐了才生成上级。 */
export const canGenerate = (entries: Entry[], period: string) =>
  periodScope(period) === "week" || missingSubPeriods(entries, period).length === 0;
