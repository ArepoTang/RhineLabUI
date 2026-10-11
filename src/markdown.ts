import DOMPurify from "dompurify";
import { marked } from "marked";

/**
 * Markdown 的唯一入口：渲染 + 消毒。
 *
 * 正文有一段来自模型输出（报告），属于不可信输入，所以**必须**过 DOMPurify：
 * 直接把 marked 的输出塞进 innerHTML 等于开门。图片、内联样式、表单、iframe 一律禁掉
 * —— 这是离线应用，远程图片既拉不到也是隐私问题；要用图再加白名单。
 */

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { gfm: true, breaks: true }) as string;
  return sanitize(html);
}

let hooked = false;

/** 没有 DOM 的场合（Node 里跑 markup 断言）原样返回：浏览器与 WebView 一定有 DOM。 */
function sanitize(html: string): string {
  if (typeof window === "undefined" || typeof document === "undefined") return html;
  if (!hooked) {
    // 外链在新标签打开，并且不留 referrer。
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node instanceof Element && node.tagName === "A" && node.getAttribute("href")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
    hooked = true;
  }
  return DOMPurify.sanitize(html, {
    // input 留着：GFM 的 `- [x]` 任务项就是 <input type="checkbox" disabled>，没有任何副作用。
    FORBID_TAGS: ["img", "picture", "source", "style", "form", "button", "iframe", "video", "audio"],
    FORBID_ATTR: ["style", "srcset", "src"],
  });
}
