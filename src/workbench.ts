import { fullMotion, type MotionPreferences } from "./motion-preferences";
import { rollText, patchRollingPanel } from "./workbench-rolling";
import { escapeHtml } from "./html";
import { wallpaperHost, type WallpaperProperties } from "./wallpaper";
import { dayKey, durationText, idleTimer, restoreTimer, timerLeft } from "./workbench-state";
import { entriesOn, entryTitle, listEntries, monthGrid, monthLabel, saveEntry, type Entry } from "./entries";
import "./workbench.css";
import { defaultWorkbenchVisibility, applyVisibilityProperties, type WorkbenchVisibility, type WorkbenchElement } from "./workbench-visibility";

const names = ["时间日期", "今日事项", "日程", "专注计时"];
const capabilityKeys = ["enabletime", "enabletasks", "enableevent", "enablefocus"];
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const key = "rhine-workbench-v1";
export class Workbench {
  enabled = false;
  private motion: MotionPreferences = fullMotion();
  setMotion(motion: MotionPreferences) {
    this.motion = { ...motion };
    if (!motion.surfaceTransitions) {
      this.root.getAnimations({ subtree: true }).forEach(animation => animation.finish());
    }
    this.lastSecond = -1;
    this.tick();
    this.renderPanel();
  }
  private root: HTMLElement;
  private props: WallpaperProperties = {};
  private lane = 0;
  private timer = idleTimer();
  private entries: Entry[] = [];
  private entryError = "";
  private selectedDay = dayKey(new Date());
  private monthAnchor = new Date();
  private date = dayKey(new Date());
  private storageOK = true;
  private lastSecond = -1;
  private exitAnimation?: Animation;
  private visibility: WorkbenchVisibility = defaultWorkbenchVisibility();
  constructor(private stage: HTMLElement, private onMode: () => void, private onLane: (lane: number) => void, private onEdit: (date: string, id?: string) => void) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      this.timer = restoreTimer(saved?.timer);
    } catch { this.storageOK = false; }
    stage.insertAdjacentHTML("beforeend", `<section class="workbench" hidden aria-label="桌面工作台">
      <div class="wb-overview"><div class="wb-time"><div class="wb-kicker">RHINE LAB / DAILY TERMINAL</div><time class="wb-clock"></time><div class="wb-date"></div></div>
      <section class="wb-today"><div class="wb-heading"><h2>今日事项</h2><span class="wb-task-count"></span></div><div class="wb-tasks"></div></section></div>
      <section class="wb-module"><div class="wb-kicker">PERSONAL WORKSPACE <span class="wb-index">01 / 05</span></div><h2 class="wb-title"></h2><div class="wb-content"></div><p class="wb-storage" role="status"></p></section>
      <nav class="wb-nav" aria-label="工作台功能">${names.map((n, i) => `<button data-wb-lane="${i}" aria-pressed="false"><small>0${i + 1}</small>${n}<span>↗</span></button>`).join("")}</nav>
    </section>`);
    this.root = stage.querySelector(".workbench")!;
    this.root.addEventListener("click", event => {
      const button = (event.target as Element).closest<HTMLButtonElement>("button");
      if (!button) return;
      if (button.dataset.wbLane !== undefined) { this.select(+button.dataset.wbLane); onLane(this.lane); }
      if (button.dataset.wbToggle !== undefined) void this.toggle(button.dataset.wbToggle);
      if (button.dataset.wbEntry !== undefined) this.onEdit(this.entry(button.dataset.wbEntry)?.date ?? this.selectedDay, button.dataset.wbEntry);
      if (button.dataset.wbNew !== undefined) this.onEdit(button.dataset.wbNew);
      if (button.dataset.wbDay !== undefined) { this.selectedDay = button.dataset.wbDay; this.renderPanel(); }
      if (button.dataset.wbMonth !== undefined) {
        this.monthAnchor = new Date(this.monthAnchor.getFullYear(), this.monthAnchor.getMonth() + Number(button.dataset.wbMonth), 1);
        this.renderPanel();
      }
      if (button.dataset.wbTimer) this.actTimer(button.dataset.wbTimer);
    });
    window.addEventListener("rhine-wallpaper-properties", event => this.apply((event as CustomEvent<WallpaperProperties>).detail));
    this.apply(wallpaperHost()?.properties ?? {});
    void this.reload();
  }
  private text(key: string) { const v = this.props[key]?.value; return typeof v === "string" ? v.trim().slice(0, 240) : ""; }
  private minutes(phase = this.timer.phase) { const n = this.props[phase === "focus" ? "focusminutes" : "breakminutes"]?.value; return typeof n === "number" && Number.isFinite(n) ? Math.max(1, Math.min(phase === "focus" ? 120 : 60, n)) : phase === "focus" ? 25 : 5; }
  private apply(props: WallpaperProperties) {
    Object.assign(this.props, props);
    this.visibility = applyVisibilityProperties(this.visibility, props);
    if (props.desktopmode) this.setEnabled(props.desktopmode.value === "workbench");
    if (!this.laneEnabled(this.lane)) {
      this.lane = capabilityKeys.findIndex((_, i) => this.laneEnabled(i));
      if (this.lane >= 0) this.onLane(this.lane);
    }
    this.renderTasks(); this.renderPanel();
    this.syncElements();
  }
  setEnabled(value: boolean) {
    this.enabled = value;
    this.stage.dataset.workbench = String(value);
    document.querySelectorAll<HTMLElement>("[data-workbench-mode]").forEach(button => button.setAttribute("aria-pressed", String((button.dataset.workbenchMode === "workbench") === value)));
    this.onMode();
    this.syncVisibility();
    this.syncElements();
  }
  syncVisibility() {
    const hidden = !this.enabled || this.stage.dataset.mode === "boot";
    const entering = this.root.hidden && !hidden;
    const reduced = !this.motion.surfaceTransitions;
    this.root.inert = hidden;
    this.root.setAttribute("aria-hidden", String(hidden));
    if (hidden && !this.root.hidden && !reduced) {
      if (!this.exitAnimation) {
        const animation = this.root.animate([{ opacity: getComputedStyle(this.root).opacity }, { opacity: 0 }], { duration: 220, fill: "forwards", easing: "ease-out" });
        this.exitAnimation = animation;
        animation.onfinish = () => { this.root.hidden = true; animation.cancel(); this.exitAnimation = undefined; };
      }
      return;
    }
    const interrupted = Boolean(this.exitAnimation);
    const opacity = getComputedStyle(this.root).opacity;
    this.exitAnimation?.cancel();
    this.exitAnimation = undefined;
    this.root.hidden = hidden;
    if (interrupted && !hidden && !reduced) this.root.animate([{ opacity }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
    if (entering) {
      [".wb-time", ".wb-today", ".wb-module", ".wb-nav"].forEach((selector, i) => {
        const element = this.root.querySelector<HTMLElement>(selector)!;
        element.getAnimations().forEach(a => a.cancel());
        if (!reduced) element.animate([{ opacity: 0, translate: "0 9px" }, { opacity: 1, translate: "0 0" }],
          { duration: 460, delay: 60 + i * 65, easing: "cubic-bezier(.22,.7,.2,1)", fill: "backwards" });
      });
    }
  }
  private laneEnabled(lane: number) { return lane >= 0 && lane < names.length && this.props[capabilityKeys[lane]]?.value !== false; }
  select(lane: number) {
    if (!this.laneEnabled(lane)) return;
    this.lane = lane;
    this.renderPanel();
  }
  settingsMarkup() {
    return `<div class="wb-settings"><strong>工作模式</strong><div><button data-workbench-mode="workbench" aria-pressed="${this.enabled}">桌面工作台</button><button data-workbench-mode="archive" aria-pressed="${!this.enabled}">档案展示</button></div><p>日程与笔记条目保存在本机浏览器存储中；专注计时时长仍来自 Wallpaper Engine 属性。</p><p>工作台元素与设置入口的显示开关位于 Wallpaper Engine 的壁纸属性中。全部关闭后只显示档案阵列；需要恢复时从那里重新打开。隐藏专注内容不会停止计时。</p></div>`;
  }
  private syncElements() {
    const selectors = { clock: ".wb-time", tasks: ".wb-today", module: ".wb-module", navigation: ".wb-nav" } as const;
    for (const [key, selector] of Object.entries(selectors)) this.root.querySelector<HTMLElement>(selector)!.hidden = !this.visibility[key as WorkbenchElement];
    const available = capabilityKeys.some((_, i) => this.laneEnabled(i));
    this.root.querySelector<HTMLElement>(".wb-module")!.hidden = !this.visibility.module || !available;
    this.root.querySelector<HTMLElement>(".wb-nav")!.hidden = !this.visibility.navigation || !available;
    this.root.querySelectorAll<HTMLButtonElement>("[data-wb-lane]").forEach(button => { button.hidden = !this.laneEnabled(+button.dataset.wbLane!); });
    this.root.querySelector<HTMLElement>(".wb-overview")!.hidden = !this.visibility.clock && !this.visibility.tasks;
    this.root.dataset.clockVisible = String(this.visibility.clock);
    this.stage.dataset.workbenchBrand = String(!this.enabled || this.visibility.brand);
    this.stage.dataset.workbenchFooter = String(!this.enabled || this.visibility.footer);
    this.stage.dataset.workbenchSettings = String(!this.enabled || this.visibility.settings);
  }
  private save() {
    try { localStorage.setItem(key, JSON.stringify({ date: this.date, timer: this.timer })); this.storageOK = true; }
    catch { this.storageOK = false; }
    this.syncStorage();
  }
  private syncStorage() {
    this.root.querySelector(".wb-storage")!.textContent = this.storageOK ? this.entryError : "当前无法保存进度，重新加载后可能丢失。";
  }
  private rollDay() {
    const today = dayKey(new Date());
    if (this.date !== today) { this.date = today; this.save(); }
  }
  /** 条目只存在本机 IndexedDB 里；读失败不能把界面弄成空白。 */
  async reload() {
    try {
      this.entries = await listEntries();
      this.entryError = "";
    } catch {
      this.entries = [];
      this.entryError = "本机存储不可用，条目无法读取或保存。";
    }
    this.renderTasks(); this.renderPanel();
  }
  entry(id: string) { return this.entries.find(item => item.id === id); }
  private async toggle(id: string) {
    const entry = this.entry(id);
    if (!entry) return;
    try { await saveEntry({ ...entry, done: !entry.done, updated: Date.now() }); }
    catch { this.entryError = "本机存储不可用，条目无法读取或保存。"; }
    await this.reload();
  }
  /** 标题为空时用正文首行充当行标题，日历与列表都用它。 */
  private entryRow(entry: Entry, detailed = false) {
    const label = escapeHtml(entryTitle(entry));
    const preview = detailed && entry.body.trim() && entry.title.trim()
      ? `<small class="wb-entry-preview">${escapeHtml(entry.body.trim().split("\n")[0].slice(0, 60))}</small>` : "";
    const time = entry.time ? `<small class="wb-entry-time">${entry.time}</small>` : "";
    return `<div class="wb-entry-row"><button class="wb-task" data-wb-toggle="${entry.id}" aria-pressed="${entry.done}"><span class="wb-check" aria-hidden="true">${entry.done ? "✓" : ""}</span><span class="wb-entry-label">${label}${preview}</span>${time}</button><button class="wb-entry-edit" data-wb-entry="${entry.id}" aria-label="编辑条目" title="编辑">✎</button></div>`;
  }
  private renderTasks() {
    const today = dayKey(new Date());
    const list = entriesOn(this.entries, today);
    const done = list.filter(item => item.done).length;
    this.root.querySelector(".wb-task-count")!.textContent = list.length ? `${done} / ${list.length}` : "";
    this.root.querySelector(".wb-tasks")!.innerHTML = list.length
      ? list.map(entry => this.entryRow(entry)).join("")
      : `<button class="wb-task wb-task-new" data-wb-new="${today}"><span class="wb-check" aria-hidden="true">＋</span><span>今天还没有条目，点这里新建</span></button>`;
  }
  private actTimer(action: string) {
    const now = Date.now();
    this.settle(now);
    if (action === "reset") this.timer = { ...idleTimer(), phase: this.timer.phase };
    if (action === "phase") this.timer = { ...idleTimer(), phase: this.timer.phase === "focus" ? "break" : "focus" };
    if (action === "toggle") {
      if (this.timer.status === "running") this.timer = { ...this.timer, status: "paused", remaining: timerLeft(this.timer, now), deadline: 0 };
      else {
        const remaining = this.timer.status === "paused" ? this.timer.remaining : this.minutes() * 60000;
        this.timer = { ...this.timer, remaining, deadline: now + remaining, status: "running" };
      }
    }
    this.save(); this.renderPanel();
    this.root.querySelector<HTMLButtonElement>(`[data-wb-timer="${action}"]`)?.focus({ preventScroll: true });
  }
  private settle(now: number) {
    if (this.timer.status === "running" && timerLeft(this.timer, now) === 0) {
      this.timer = { ...this.timer, status: "done", remaining: 0, deadline: 0 }; this.save(); this.renderPanel();
    }
  }
  tick(now = Date.now()) {
    if (Math.floor(now / 1000) === this.lastSecond) return;
    this.lastSecond = Math.floor(now / 1000);
    this.rollDay(); this.settle(now);
    const date = new Date(now);
    rollText(this.root.querySelector<HTMLElement>(".wb-clock")!, date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), this.motion.rollingText);
    this.root.querySelector(".wb-date")!.textContent = date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
    // 只有年份进度依赖当下时刻；日历不该每秒重建一次。
    if (this.lane === 0) this.renderPanel();
    const timer = this.root.querySelector(".wb-timer-digits");
    if (timer) rollText(timer as HTMLElement, durationText(this.timer.status === "idle" ? this.minutes() * 60000 : timerLeft(this.timer, now)), this.motion.rollingText);
  }
  private renderPanel() {
    if (this.lane < 0) {
      this.root.querySelector(".wb-title")!.textContent = "";
      this.root.querySelector(".wb-content")!.replaceChildren();
      return;
    }
    this.root.querySelector(".wb-title")!.textContent = names[this.lane];
    const available = capabilityKeys.map((_, i) => i).filter(i => this.laneEnabled(i));
    this.root.querySelector(".wb-index")!.textContent = `${String(available.indexOf(this.lane) + 1).padStart(2, "0")} / ${String(available.length).padStart(2, "0")}`;
    this.root.querySelectorAll<HTMLButtonElement>("[data-wb-lane]").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.wbLane! === this.lane)));
    let html = "";
    if (this.lane === 0) {
      const now = new Date(), end = new Date(now.getFullYear() + 1, 0, 1).getTime(), start = new Date(now.getFullYear(), 0, 1).getTime();
      const percent = (now.getTime() - start) / (end - start) * 100;
      html = `<div class="wb-large">${now.getFullYear()}<small>YEAR</small></div><div class="wb-rule"><i style="width:${percent}%"></i></div><p class="wb-muted">今年已走过 ${percent.toFixed(1)}%</p>`;
    }
    if (this.lane === 1) {
      const today = dayKey(new Date());
      const list = entriesOn(this.entries, today);
      const open = list.filter(item => !item.done).length;
      html = `<div class="wb-large">${String(open).padStart(2, "0")}<small>待办</small></div><div class="wb-entries">${list.length ? list.map(item => this.entryRow(item, true)).join("") : '<p class="wb-muted">今天还没有条目。</p>'}</div><div class="wb-timer-buttons"><button data-wb-new="${today}">新建今日条目</button></div><p class="wb-muted">条目按天保存，勾选完成不会在第二天被清空。</p>`;
    }
    if (this.lane === 2) {
      const year = this.monthAnchor.getFullYear(), month = this.monthAnchor.getMonth();
      const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
      const counts = new Map<string, number>();
      for (const item of this.entries) counts.set(item.date, (counts.get(item.date) ?? 0) + 1);
      const today = dayKey(new Date());
      const days = monthGrid(year, month).map(day => {
        const count = counts.get(day) ?? 0;
        return `<button class="wb-day" data-wb-day="${day}" aria-pressed="${day === this.selectedDay}"${day.startsWith(prefix) ? "" : ' data-outside="true"'}${day === today ? ' data-today="true"' : ""}><span>${Number(day.slice(8))}</span>${count ? `<i>${count > 9 ? "9+" : count}</i>` : ""}</button>`;
      }).join("");
      const list = entriesOn(this.entries, this.selectedDay);
      html = `<div class="wb-cal-head"><button data-wb-month="-1" aria-label="上个月">←</button><strong>${monthLabel(year, month)}</strong><button data-wb-month="1" aria-label="下个月">→</button></div><div class="wb-cal-week">${WEEKDAYS.map(day => `<span>${day}</span>`).join("")}</div><div class="wb-cal">${days}</div><div class="wb-entries">${list.length ? list.map(item => this.entryRow(item, true)).join("") : `<p class="wb-muted">${this.selectedDay} 没有条目。</p>`}</div><div class="wb-timer-buttons"><button data-wb-new="${this.selectedDay}">在这一天新建</button></div>`;
    }
    if (this.lane === 3) html = `<div class="wb-timer-label">${this.timer.phase === "focus" ? "专注" : "休息"} · ${this.timer.status === "done" ? "已结束" : this.timer.status === "running" ? "进行中" : this.timer.status === "paused" ? "已暂停" : "准备开始"}</div><div class="wb-large wb-timer-digits" data-wb-roll>${durationText(this.timer.status === "idle" ? this.minutes() * 60000 : timerLeft(this.timer, Date.now()))}</div><div class="wb-timer-buttons"><button data-wb-timer="toggle">${this.timer.status === "running" ? "暂停" : this.timer.status === "paused" ? "继续" : "开始"}</button><button data-wb-timer="reset">重置</button><button data-wb-timer="phase">${this.timer.phase === "focus" ? "转入休息" : "开始专注"}</button></div><p class="wb-muted">${this.timer.status === "done" ? "这一段时间已完成。准备好后再开始下一段。" : "暂停壁纸或重新加载后按实际时间校正。"}<br>时长在 Wallpaper Engine 中设置。</p>`;
    patchRollingPanel(this.root.querySelector<HTMLElement>(".wb-content")!, html, this.motion.rollingText);
    this.syncStorage();
  }
}

