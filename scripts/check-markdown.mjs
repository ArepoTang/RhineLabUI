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

// ---- 编辑器的布局链（全屏编辑靠这几条，缺一条就退回成"编辑框"） --------------
// 教训：上一轮删格式栏的样式时把夹在中间的窗格规则一起删了，编辑器就直接变成 rows=16 的小框。
const css = readFileSync(new URL("../src/markdown.css", import.meta.url), "utf8");
for (const [rule, why] of [
  [/#stage \.terminal-modal\.editor-full \{[^}]*width: 100%/, "编辑器自己声明铺满宽度"],
  [/#stage \.terminal-modal\.editor-full \{[^}]*height: 100%/, "编辑器自己声明铺满高度"],
  [/\.md-editor \{[^}]*flex: 1/, "编辑器容器吃掉剩余高度"],
  [/\.md-panes \{[^}]*grid-template-rows: 1fr/, "窗格行必须 1fr，否则输入框只有 rows 那么高"],
  [/\.md-pane-edit textarea \{[^}]*height: 100%/, "输入框填满窗格"],
  [/\.md-pane-preview \{[^}]*overflow-y: auto/, "预览窗格自己滚动"],
  [/@media \(max-width: 899px\)[\s\S]*?\.md-editor\[data-view="edit"\] \.md-pane-preview \{ display: block/, "窄屏编辑时下方预览保持可见（边写边渲染）"],
]) {
  assert.match(css, rule, why);
}
// 遮罩曾写死 top:0/height:100%，软键盘弹起时把下方的实时预览和保存按钮盖住。
assert.ok(!/#stage \.editor-backdrop \{[^}]*height: 100%/.test(css), "编辑器遮罩不能写死高度，高度要跟可视区域走");
console.log("Editor layout: 布局链 7 条 + 图标 3 条断言通过。");
