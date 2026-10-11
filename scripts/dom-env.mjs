/**
 * 给 Node 里的 markup 断言一个真的 DOM。
 *
 * markdown.ts 的消毒（DOMPurify）需要 window/document，而且要看**导入 DOMPurify 之前**
 * 有没有 window，所以必须在 import 被测模块之前调用它。
 */
export async function setupDom() {
  let JSDOM;
  try {
    ({ JSDOM } = await import("jsdom"));
  } catch {
    console.error("这些检查需要 devDependency jsdom（npm install -D jsdom）");
    process.exit(1);
  }
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  globalThis.window ??= dom.window;
  globalThis.document ??= dom.window.document;
  globalThis.Element ??= dom.window.Element;
  globalThis.Node ??= dom.window.Node;
}
