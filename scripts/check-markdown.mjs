// Markdown 渲染与消毒：正文里有一段是模型输出（不可信），这里必须真跑一遍消毒。
// 需要 devDependency jsdom 提供 window/document。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { setupDom } = await import("./dom-env.mjs");
await setupDom();

const { renderMarkdown } = await import("../src/markdown.ts");

// ---- 渲染 -----------------------------------------------------------------
assert.match(renderMarkdown("## 标题"), /<h2[^>]*>标题<\/h2>/, "标题");
assert.match(renderMarkdown("- 甲\n- 乙"), /<ul>[\s\S]*甲[\s\S]*乙[\s\S]*<\/ul>/, "无序列表");
assert.match(renderMarkdown("1. 甲\n2. 乙"), /<ol>[\s\S]*甲[\s\S]*<\/ol>/, "有序列表");
assert.match(renderMarkdown("- [x] 做完的\n- [ ] 没做的"), /type="checkbox"/, "任务列表（GFM）");
assert.match(renderMarkdown("| 甲 | 乙 |\n| - | - |\n| 1 | 2 |"), /<table>[\s\S]*<td>1<\/td>[\s\S]*<\/table>/, "表格（GFM）");
assert.match(renderMarkdown("~~划掉~~"), /<del>划掉<\/del>/, "删除线（GFM）");
assert.match(renderMarkdown("```\ncode\n```"), /<pre>[\s\S]*<code>[\s\S]*code[\s\S]*<\/code>[\s\S]*<\/pre>/, "围栏代码块");
assert.match(renderMarkdown("行内 `x` 代码"), /<code>x<\/code>/, "行内代码");
assert.match(renderMarkdown("> 引用"), /<blockquote>[\s\S]*引用[\s\S]*<\/blockquote>/, "引用");
assert.match(renderMarkdown("一行\n下一行"), /一行<br\s*\/?>下一行|一行\s*<br>下一行/, "单换行保留成折行（日志正文就这么写）");
assert.equal(renderMarkdown(""), "", "空文本渲染成空");

// ---- 消毒（这是安全边界，不能省） ------------------------------------------
const evil = renderMarkdown('正常 <script>alert(1)</script> <img src=x onerror="alert(2)"> [点我](javascript:alert(3))');
assert.ok(!evil.includes("<script"), "script 必须被剥掉");
assert.ok(!/on\w+=/i.test(evil), "事件属性必须被剥掉");
assert.ok(!evil.includes("javascript:"), "javascript: 链接必须被剥掉");
assert.ok(!evil.includes("<img"), "离线应用不放图片（也不想被远程请求）");
assert.ok(evil.includes("正常"), "正常文字要留下");
assert.ok(!renderMarkdown('<div style="position:fixed;top:0">覆盖</div>').includes("style="), "内联样式剥掉");
assert.ok(!renderMarkdown("<iframe src=https://x.test></iframe>").includes("<iframe"), "iframe 剥掉");

const link = renderMarkdown("[文档](https://example.test/a)");
assert.match(link, /target="_blank"/, "外链新标签打开");
assert.match(link, /rel="noopener noreferrer"/, "外链不留 referrer");

console.log("Markdown: 渲染 13 项、消毒 8 项断言通过。");

// ---- 实时渲染（Typora 式）：藏源代码标记、光标处再露出来 --------------------
const { liveMarkdownSpans } = await import("../src/markdown-editor.ts");
const hides = (spans) => spans.filter((s) => s.kind === "hide").map((s) => [s.from, s.to]);
const has = (spans, kind, value) => spans.some((s) => s.kind === kind && s.value === value);

const heading = liveMarkdownSpans("## 标题");
assert.deepEqual(hides(heading), [[0, 3]], "标题的 ## 藏起来");
assert.ok(has(heading, "line", "md-h2"), "行上挂标题样式");
assert.deepEqual(hides(liveMarkdownSpans("## 标题", [{ from: 4, to: 4 }])), [], "光标在行内时露出 ##");

const strong = liveMarkdownSpans("**粗体**");
assert.deepEqual(hides(strong), [[0, 2], [4, 6]], "粗体星号藏起来");
assert.ok(strong.some((s) => s.kind === "mark" && s.value === "md-strong" && s.from === 2 && s.to === 4), "粗体内容套样式");
assert.deepEqual(hides(liveMarkdownSpans("**粗体**", [{ from: 3, to: 3 }])), [], "光标进到粗体里时露出星号");
assert.deepEqual(hides(liveMarkdownSpans("**粗体**", [{ from: 6, to: 6 }])), [[0, 2], [4, 6]], "打完收尾 ** 后光标停在后面也不露星号");
assert.deepEqual(hides(liveMarkdownSpans("**粗体**", [{ from: 5, to: 5 }])), [], "光标踩到收尾星号时才露出");

const code = liveMarkdownSpans("行内 `x` 代码");
assert.equal(hides(code).length, 2, "行内代码的反引号藏起来");
assert.ok(has(code, "mark", "md-code-inline"));

const mdLink = liveMarkdownSpans("[文档](https://a.b)");
assert.deepEqual(hides(mdLink), [[0, 1], [3, 17]], "链接只留文字");
assert.ok(mdLink.some((s) => s.kind === "mark" && s.value === "md-link" && s.from === 1 && s.to === 3));
assert.deepEqual(hides(liveMarkdownSpans("[文档](https://a.b)", [{ from: 2, to: 2 }])), [], "光标在链接里时露出源码");

const bullet = liveMarkdownSpans("- 项目");
assert.ok(has(bullet, "line", "md-li"));
assert.ok(bullet.some((s) => s.kind === "replace" && s.value === "bullet" && s.from === 0 && s.to === 2), "列表点换成圆点");
const task = liveMarkdownSpans("- [x] 完成");
assert.ok(task.some((s) => s.kind === "replace" && s.value === "check-on"), "任务项换成勾选框");
assert.ok(has(liveMarkdownSpans("1. 项目"), "line", "md-li"), "有序列表保留数字但用列表排版");
assert.ok(liveMarkdownSpans("> 引用").some((s) => s.kind === "line" && s.value.includes("md-quote")));
assert.ok(liveMarkdownSpans("> 引用").some((s) => s.kind === "hide" && s.from === 0 && s.to === 2), "引用符藏起来");
const quoteLines = (spans) => spans.filter((s) => s.kind === "line" && s.value.includes("md-quote"));
assert.equal(quoteLines(liveMarkdownSpans("> 第一行\n> 第二行")).length, 2, "每行都带 > 的引用两行都渲染");
assert.equal(liveMarkdownSpans("> 第一行\n> 第二行").filter((s) => s.kind === "line" && s.value.includes("md-quote-start")).length, 1, "整段引用只在第一行放大引号");
assert.deepEqual(hides(liveMarkdownSpans("> 第一行\n> 第二行")), [[0, 2], [6, 8]], "两行的 > 都藏起来");
const lazyQuote = liveMarkdownSpans("> 第一行\n第二行");
assert.equal(quoteLines(lazyQuote).length, 2, "没写 > 的续行也跟着上一条引用渲染");
assert.deepEqual(hides(lazyQuote), [[0, 2]], "续行没有需要藏的标记");
assert.ok(liveMarkdownSpans("> > 嵌套").some((s) => s.kind === "line" && s.value.includes("md-quote-2")), "多级引用多缩进一层");
assert.deepEqual(hides(liveMarkdownSpans("> > 嵌套")), [[0, 4]], "多级引用的两个 > 都藏起来");
assert.equal(quoteLines(liveMarkdownSpans("> 引用\n\n普通段落")).length, 1, "空行结束引用");
assert.equal(quoteLines(liveMarkdownSpans("> 引用\n- 列表")).length, 1, "引用后直接接列表就结束引用");

const block = liveMarkdownSpans("```\n# 不是标题\n```");
assert.ok(has(block, "line", "md-fence"), "围栏行");
assert.ok(has(block, "line", "md-code"), "围栏里的代码行");
assert.ok(!block.some((s) => s.value === "md-h1"), "代码块里的 # 不当标题");
assert.deepEqual(hides(block), [[0, 3], [11, 14]], "围栏标记藏起来");
assert.ok(has(liveMarkdownSpans("---"), "replace", "rule"), "分割线换成一条线");

const composing = liveMarkdownSpans("## 标题", [], true);
assert.deepEqual(hides(composing), [], "输入法合成期间不藏任何标记");
assert.ok(has(composing, "line", "md-h2"), "合成期间标题样式仍保留");

for (const spans of [heading, strong, code, mdLink, block]) {
  const hidden = spans.filter((s) => s.kind === "hide");
  for (let i = 1; i < hidden.length; i++)
    assert.ok(hidden[i].from >= hidden[i - 1].to, "隐藏区间不能重叠");
  for (let i = 1; i < spans.length; i++)
    assert.ok(spans[i].from >= spans[i - 1].from, "decoration 必须按位置排序");
}
// ---- 引用里的回车：自动续行 / 空行退出 / 围栏内不动 --------------------------
const { EditorState } = await import("@codemirror/state");
const { quoteEnterPlan } = await import("../src/markdown-editor.ts");
const enterPlan = (doc, pos) => quoteEnterPlan(EditorState.create({ doc, selection: { anchor: pos } }));
assert.deepEqual(enterPlan("> 引用", 4), { from: 4, to: 4, insert: "\n> ", anchor: 7 }, "回车自动补 >，光标落在缩进里");
assert.deepEqual(enterPlan("> > 嵌套", 6), { from: 6, to: 6, insert: "\n> > ", anchor: 11 }, "多级引用按原层级续行");
assert.deepEqual(enterPlan("> a\nb", 5), { from: 5, to: 5, insert: "\n> ", anchor: 8 }, "没写 > 的续行回车也补上");
assert.deepEqual(enterPlan("> a\n> ", 6), { from: 4, to: 6, insert: "\n", anchor: 5 }, "空引用行按一次回车退出，不再多留空行");
assert.equal(enterPlan("普通段落", 4), null, "普通段落回车交给默认行为");
assert.equal(enterPlan("> a\n\nb", 6), null, "空行之后不再是引用");
assert.equal(enterPlan("- 列表", 4), null, "列表回车不补引用");
assert.equal(enterPlan("```\n> a", 7), null, "代码块里回车不碰引用");
console.log("Live editor: 边写边渲染断言通过。");

// ---- 编辑器的布局链（全屏编辑靠这几条，缺一条编辑器就不铺满 / 不跟主题字体） ----
const css = readFileSync(new URL("../src/markdown.css", import.meta.url), "utf8");
for (const [rule, why] of [
  [/#stage \.terminal-modal\.editor-full \{[^}]*width: 100%/, "编辑器自己声明铺满宽度"],
  [/#stage \.terminal-modal\.editor-full \{[^}]*height: 100%/, "编辑器自己声明铺满高度"],
  [/\.md-editor \{[^}]*flex: 1/, "编辑器容器吃掉剩余高度"],
  [/\.md-edit \{[^}]*flex: 1/, "挂载点吃掉剩余高度"],
  [/\.md-editor \.md-edit \.cm-editor \{[^}]*flex: 1/, "CodeMirror 填满挂载点"],
  [/\.md-editor \.md-edit \.cm-scroller \{[^}]*font-family: inherit/, "编辑器跟主题字体，不用 CodeMirror 的 monospace"],
  [/\.md-editor \.md-edit \.cm-line\.md-h1 \{[^}]*padding-top/, "标题上边距压过 .cm-line 的 padding: 0"],
  [/\.md-editor \.md-edit \.cm-line\.md-li \{[^}]*padding-left/, "列表缩进压过 .cm-line 的 padding: 0"],
  [/\.md-editor \.md-edit \.cm-line\.md-quote \{[^}]*padding-left: 8%/, "引用缩进用百分比，压过 .cm-line 的 padding: 0"],
  [/\.md-editor \.md-strong \{/, "粗体在编辑区里直接渲染"],
]) {
  assert.match(css, rule, why);
}
// 遮罩曾写死 top:0/height:100%，软键盘弹起时把下方的保存按钮盖住。
assert.ok(!/#stage \.editor-backdrop \{[^}]*height: 100%/.test(css), "编辑器遮罩不能写死高度，高度要跟可视区域走");
console.log("Editor layout: 布局链 10 条 + 源码开关断言通过。");
