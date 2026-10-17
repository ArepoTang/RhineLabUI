import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Compartment, EditorState, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * Typora 式的「边写边渲染」：文档里始终存 Markdown 原文，
 * 显示时把标题、粗体等渲染出来，并把源代码标记藏起来；
 * 光标碰到的块/行内标记会重新露出原文，方便直接改。
 *
 * 用 CodeMirror 6 只管输入、光标、输入法、撤销和选择 —— 这些自己写必翻车。
 * 渲染完全由下面的 decoration 生成，不产生第二份文档。
 */

export type MarkdownEditor = {
  value(): string;
  focus(): void;
  /** 开/关实时渲染；返回切换后的状态。 */
  toggleLive(): boolean;
  destroy(): void;
};

/** 解析结果的一条：hide=藏源码，mark=套 class，line=整行 class，replace=换成小组件。 */
export type LiveSpan = {
  from: number;
  to: number;
  kind: "hide" | "mark" | "line" | "replace";
  value: string;
};

type Selection = { from: number; to: number };

/**
 * 把 Markdown 拆成 decoration 描述（纯函数，可在 Node 里断言）。
 * 位置都是全文偏移；返回值按 from 排序。
 */
export function liveMarkdownSpans(
  text: string,
  selections: Selection[] = [],
  composing = false,
): LiveSpan[] {
  const spans: LiveSpan[] = [];
  const touched = (from: number, to: number) =>
    selections.some((r) => r.from <= to && r.to >= from);

  const addMark = (from: number, to: number, cls: string) => {
    if (to > from) spans.push({ from, to, kind: "mark", value: cls });
  };
  const addHide = (from: number, to: number) => {
    // 输入法合成期间不动结构，否则安卓上的候选词/光标会乱。
    if (!composing && to > from) spans.push({ from, to, kind: "hide", value: "" });
  };
  const addLine = (pos: number, cls: string) =>
    spans.push({ from: pos, to: pos, kind: "line", value: cls });

  let offset = 0;
  let fence = false;
  let quote = false;
  for (const lineText of text.split("\n")) {
    const lineFrom = offset;
    const lineTo = offset + lineText.length;
    offset = lineTo + 1;
    const at = (index: number) => lineFrom + index;

    if (/^\s{0,3}(```|~~~)/.test(lineText)) {
      addLine(lineFrom, "md-fence");
      if (!touched(lineFrom, lineTo)) addHide(lineFrom, lineTo);
      fence = !fence;
      continue;
    }
    if (fence) {
      addLine(lineFrom, "md-code");
      continue;
    }
    // 空行结束引用；紧接着的普通行按 CommonMark 的 lazy continuation 仍算引用。
    if (lineText.trim() === "") {
      quote = false;
      continue;
    }

    const quoteMark = /^((?:\s{0,3}>\s?)+)/.exec(lineText);
    if (quoteMark) {
      const first = !quote;
      quote = true;
      const depth = (quoteMark[0].match(/>/g) ?? []).length;
      const classes = ["md-quote"];
      if (first) classes.push("md-quote-start");
      if (depth > 1) classes.push(`md-quote-${Math.min(depth, 3)}`);
      addLine(lineFrom, classes.join(" "));
      if (!touched(lineFrom, lineTo)) addHide(lineFrom, at(quoteMark[0].length));
      inlineDecorations(lineText, lineFrom, addMark, addHide, touched);
      continue;
    }
    if (quote) {
      // 引用里的续行没写 >：只要不是新块的开始，就仍按引用显示。
      if (!/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|```|~~~|(?:-[ \t]*){3,}|(?:\*[ \t]*){3,})/.test(lineText)) {
        addLine(lineFrom, "md-quote");
        inlineDecorations(lineText, lineFrom, addMark, addHide, touched);
        continue;
      }
      quote = false;
    }

    if (/^\s{0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(lineText)) {
      if (!composing && !touched(lineFrom, lineTo))
        spans.push({ from: lineFrom, to: lineTo, kind: "replace", value: "rule" });
      continue;
    }

    const task = /^(\s*)([-*+])\s+\[([ xX])\]\s+/.exec(lineText);
    if (task) {
      addLine(lineFrom, "md-li");
      if (!composing && !touched(lineFrom, lineTo))
        spans.push({
          from: at(task[1].length),
          to: at(task[0].length),
          kind: "replace",
          value: task[3].toLowerCase() === "x" ? "check-on" : "check",
        });
      inlineDecorations(lineText, lineFrom, addMark, addHide, touched);
      continue;
    }

    const bullet = /^(\s*)([-*+])\s+/.exec(lineText);
    if (bullet) {
      addLine(lineFrom, "md-li");
      if (!composing && !touched(lineFrom, lineTo))
        spans.push({
          from: at(bullet[1].length),
          to: at(bullet[0].length),
          kind: "replace",
          value: "bullet",
        });
      inlineDecorations(lineText, lineFrom, addMark, addHide, touched);
      continue;
    }

    if (/^(\s*)(\d+)[.)]\s+/.test(lineText)) {
      addLine(lineFrom, "md-li");
      inlineDecorations(lineText, lineFrom, addMark, addHide, touched);
      continue;
    }

    const heading = /^(#{1,6})\s+/.exec(lineText);
    if (heading) {
      addLine(lineFrom, `md-h${heading[1].length}`);
      if (!touched(lineFrom, lineTo)) addHide(lineFrom, at(heading[0].length));
      inlineDecorations(lineText, lineFrom, addMark, addHide, touched);
      continue;
    }

    inlineDecorations(lineText, lineFrom, addMark, addHide, touched);
  }

  // 行装饰是零长度，必须排在同一个起点的隐藏/标记之前。
  spans.sort((a, b) => a.from - b.from || a.to - b.to);
  return spans;
}

/** 单行内的行内标记：代码、链接、粗体、斜体、删除线。 */
function inlineDecorations(
  text: string,
  base: number,
  addMark: (from: number, to: number, cls: string) => void,
  addHide: (from: number, to: number) => void,
  touched: (from: number, to: number) => boolean,
): void {
  const taken: Array<[number, number]> = [];
  const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x);
  const keep = (a: number, b: number) => taken.push([a, b]);
  // 只算「在标记或内容里」；光标刚停在收尾标记后面时不算，否则打完 **粗体** 会一直露着星号。
  const reveal = (a: number, b: number) => touched(base + a, base + b - 1);

  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const a = m.index ?? 0;
    const b = a + m[0].length;
    if (!free(a, b)) continue;
    keep(a, b);
    addMark(base + a + 1, base + b - 1, "md-code-inline");
    if (!reveal(a, b)) {
      addHide(base + a, base + a + 1);
      addHide(base + b - 1, base + b);
    }
  }

  for (const m of text.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)/g)) {
    const a = m.index ?? 0;
    const b = a + m[0].length;
    if (!free(a, b)) continue;
    keep(a, b);
    const textStart = a + 1;
    const textEnd = textStart + m[1].length;
    addMark(base + textStart, base + textEnd, "md-link");
    if (!reveal(a, b)) {
      addHide(base + a, base + textStart);
      addHide(base + textEnd, base + b);
    }
  }

  for (const m of text.matchAll(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g)) {
    const a = m.index ?? 0;
    const b = a + m[0].length;
    if (!free(a, b)) continue;
    keep(a, b);
    addMark(base + a + 2, base + b - 2, "md-strong");
    if (!reveal(a, b)) {
      addHide(base + a, base + a + 2);
      addHide(base + b - 2, base + b);
    }
  }

  for (const m of text.matchAll(/([*_])([^*_\n]+?)\1/g)) {
    const a = m.index ?? 0;
    const b = a + m[0].length;
    const inner = m[2];
    if (!inner || /^\s|\s$/.test(inner)) continue;
    // 避开 ** / __ 的第 2 个字符，以及嵌套在已处理标记里的星号。
    if (text[a - 1] === m[1] || text[b] === m[1]) continue;
    if (!free(a, b)) continue;
    keep(a, b);
    addMark(base + a + 1, base + b - 1, "md-em");
    if (!reveal(a, b)) {
      addHide(base + a, base + a + 1);
      addHide(base + b - 1, base + b);
    }
  }

  for (const m of text.matchAll(/~~(?=\S)([\s\S]*?\S)~~/g)) {
    const a = m.index ?? 0;
    const b = a + m[0].length;
    if (!free(a, b)) continue;
    keep(a, b);
    addMark(base + a + 2, base + b - 2, "md-strike");
    if (!reveal(a, b)) {
      addHide(base + a, base + a + 2);
      addHide(base + b - 2, base + b);
    }
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "md-bullet";
    span.textContent = "•";
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

class CheckWidget extends WidgetType {
  checked: boolean;
  constructor(checked: boolean) {
    super();
    this.checked = checked;
  }
  eq(other: CheckWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = this.checked ? "md-check md-check-on" : "md-check";
    span.textContent = this.checked ? "☑" : "☐";
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "md-rule";
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

const HIDE = Decoration.replace({});

/** 描述 → CodeMirror decoration。 */
function presentation(spans: LiveSpan[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const span of spans) {
    if (span.kind === "mark") builder.add(span.from, span.to, Decoration.mark({ class: span.value }));
    else if (span.kind === "hide") builder.add(span.from, span.to, HIDE);
    else if (span.kind === "line") builder.add(span.from, span.to, Decoration.line({ class: span.value }));
    else {
      const widget =
        span.value === "bullet"
          ? new BulletWidget()
          : span.value === "rule"
            ? new RuleWidget()
            : new CheckWidget(span.value === "check-on");
      builder.add(
        span.from,
        span.to,
        Decoration.replace(span.value === "rule" ? { widget, block: true } : { widget }),
      );
    }
  }
  return builder.finish();
}

function buildDecorations(view: EditorView): DecorationSet {
  return presentation(
    liveMarkdownSpans(
      view.state.doc.toString(),
      view.state.selection.ranges.map((r) => ({ from: r.from, to: r.to })),
      view.composing,
    ),
  );
}

const livePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged)
        this.decorations = buildDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export function createMarkdownEditor(
  host: HTMLElement,
  initial: string,
  onChange: (value: string) => void,
): MarkdownEditor {
  const live = new Compartment();
  let liveOn = true;
  const view = new EditorView({
    state: EditorState.create({
      doc: initial,
      extensions: [
        history(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": "正文（Markdown）", spellcheck: "false" }),
        live.of(livePlugin),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString());
        }),
        // 手机没有 Tab 键；其余交给默认键位（回车、退格、撤销都在里面）。
        keymap.of([...historyKeymap, ...defaultKeymap]),
      ],
    }),
    parent: host,
  });
  host.dataset.live = "true";

  return {
    value: () => view.state.doc.toString(),
    focus: () => view.focus(),
    toggleLive: () => {
      liveOn = !liveOn;
      view.dispatch({ effects: live.reconfigure(liveOn ? livePlugin : []) });
      host.dataset.live = String(liveOn);
      view.focus();
      return liveOn;
    },
    destroy: () => {
      view.destroy();
      host.replaceChildren();
    },
  };
}
