/**
 * 导出文本的宿主出口：APK 里有原生桥（RhineLabAndroid 的 ExportBridge），
 * 由它写进 Documents/RhineLab；没有桥（浏览器/PWA）时由调用方走 Blob 下载。
 */
declare global {
  interface Window {
    RhineLabExport?: { saveLog(name: string, text: string): string };
  }
}

/** @return 宿主写入的相对路径；没有桥或写入失败返回 ""。 */
export function saveViaHost(name: string, text: string): string {
  try {
    return window.RhineLabExport?.saveLog(name, text)?.trim() ?? "";
  } catch {
    return "";
  }
}
