// 设置页的文案与层级：删掉的说明不能偷偷回来，分组结构也不能被拍平。
// 这是源码级的检查（settingsMarkup 在 main.ts 里，跑不了 Node），够用：改动一旦被逆转，这里就红。
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const GROUPS = [
  ["display", "显示与画面"],
  ["motion", "动效与开场"],
  ["sound", "声音"],
  ["report", "报告"],
  ["control", "控制与维护"],
];

test("设置页：已删掉的说明不再出现", () => {
  for (const gone of [
    "留空恢复 JOYCE MOORE",
    "静默补上一期",
    "不随导出文件走",
    "没填 key 就用下面的手动档",
    "压缩会把上面这段交给模型合并去重",
    "默认英文，输出跟随日志语言",
    "留空则用默认",
    "每期都会附给模型的固定背景",
    "待办可以是一句话，也可以是带时间的安排",
    "第一次进入，先确认身份",
    "预设：完整动画",
    "开场身份确认、页脚与日志署名",
  ]) {
    assert.ok(!main.includes(gone), `「${gone}」应该已经删掉`);
  }
  assert.ok(main.includes("<strong>Operater ID</strong>"), "身份那一行只剩标题");
  assert.ok(main.includes("Welcome, type your name."), "首次进入只留一句话（英文）");
});

test("设置页：五个分组都在，且都是可折叠的 details", () => {
  for (const [key, title] of GROUPS) {
    assert.ok(main.includes(`settingsGroup("${key}", "${title}"`), `缺少分组 ${title}`);
  }
  const groups = main.match(/class="settings-group"/g) ?? [];
  assert.ok(groups.length === 1, "只有 settingsGroup() 这一处生成分组容器（避免有人另写一份）");
  assert.match(main, /<details class="settings-group" data-group="\$\{key\}"\$\{open \? " open" : ""\}/, "分组是可折叠的 details");
  assert.match(main, /settingsGroup\("sound", "声音", "[^"]*", sound, true\)/, "只有声音默认展开");
  assert.match(main, /isWallpaper \? "" : settingsGroup\("report"/, "报告分组只在网页/APK 出现");
});

test("设置页：报告栏不再自带宽边距的折叠壳（折叠交给分组）", () => {
  assert.ok(!main.includes('class="settings-reports"'), "报告栏不该再套一层 details");
  assert.ok(main.includes('class="settings-report-body"'), "报告内容仍然放在 body 里");
  assert.ok(!main.includes("settings-report-note"), "那条说明连同样式一起去掉");
  assert.ok(!main.includes("report-run-note"), "压缩记忆那一行只留按钮，不再带说明");
  assert.ok(!main.includes("settings-report-field small"), "提示词下面不再挂灰色小字");
  assert.ok(!readFileSync(new URL("../src/entries-ui.ts", import.meta.url), "utf8").includes("待办可以是一句话"), "日历编辑器顶部那句说明也删掉");
});

test("设置页：重渲染不会把用户展开的分组收回去", () => {
  assert.ok(main.includes("const settingsGroupOpen: Record<string, boolean> = {}"), "展开状态要记在会话里");
  assert.match(main, /addEventListener\(\s*"toggle"/, "监听 details 的 toggle");
  assert.ok(main.includes("  },\n  true,\n);"), "toggle 不冒泡，必须用捕获阶段监听");
  assert.match(main, /if \(modal === "settings"\) applyGroupState\(\$\("#modal-root"\)\);/, "每次渲染完设置页都要套回展开状态");
  assert.match(main, /if \(settingsPanel\) applyGroupState\(settingsPanel\);/, "动效的局部重渲染也要套回");
  assert.ok(main.includes('data-group="prompts"'), "嵌套的提示词折叠也要记状态");
  assert.ok(readFileSync(new URL("../src/motion-preferences.ts", import.meta.url), "utf8").includes('data-group="motion-advanced"'), "精细设置折叠也要记状态");
});
