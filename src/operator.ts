/**
 * 操作员 ID：设置里可改，开场身份确认、页脚、设置抬头与日志署名共用。
 *
 * boot-motion 是纯函数、被 Node 检查直接调用，所以它只读这个模块里的活绑定，
 * 不碰 localStorage；页面在启动时调一次 loadOperatorId() 把持久值推进来。
 */
const DEFAULT_OPERATOR = "JOYCE MOORE";
const STORAGE_KEY = "rhine-settings";

export let operatorId = DEFAULT_OPERATOR;

/** 留空（或只有空白）恢复默认，避免页脚和开屏出现空名字。 */
export function setOperatorId(value: string) {
  operatorId = value.trim().slice(0, 24) || DEFAULT_OPERATOR;
}

export function loadOperatorId() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { operatorId?: unknown } | null;
    if (typeof stored?.operatorId === "string") setOperatorId(stored.operatorId);
  } catch {
    /* 存储不可用时保留默认名字。 */
  }
}
