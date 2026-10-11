/**
 * 发一次报告请求：OpenAI 兼容的 /chat/completions。
 *
 * 这里只有「把提示词发出去、把正文拿回来」，不管重试、不管界面、不碰存储 ——
 * 所以可以在 Node 里用假的 fetch 断言请求形状（scripts/check-reports.mjs）。
 * 服务商必须支持浏览器直连（CORS）：地址与 key 都由用户在设置里填。
 */

export type ReportRequest = {
  /** 形如 https://openrouter.ai/api/v1（结尾的 / 会被去掉）。 */
  provider: string;
  model: string;
  key: string;
  /** buildPrompt 的结果。 */
  prompt: { system: string; user: string };
  /** 取消（用户在设置里按取消，或关掉窗口）。 */
  signal?: AbortSignal;
  /** 单次请求的硬超时；到点当作失败，避免一次卡死整个队列。 */
  timeoutMs?: number;
  /** 测试注入用。 */
  fetchImpl?: typeof fetch;
};

export const chatEndpoint = (provider: string) => `${provider.trim().replace(/\/+$/, "")}/chat/completions`;

/** 一次请求的正文；失败抛 Error，消息里带上能看懂的 причины（HTTP 状态或服务商回的原话）。 */
export async function requestReport(request: ReportRequest): Promise<string> {
  const { provider, model, key, prompt, signal } = request;
  if (!provider.trim() || !model.trim() || !key.trim()) throw new Error("还没填服务商地址、模型名或 key");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? 120_000);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await (request.fetchImpl ?? fetch)(chatEndpoint(provider), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key.trim()}` },
      body: JSON.stringify({
        model: model.trim(),
        stream: false,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}：${text.slice(0, 200) || "没有返回内容"}`);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`返回的不是 JSON：${text.slice(0, 200)}`);
    }
    const body = (payload as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
    if (typeof body !== "string" || !body.trim()) throw new Error("返回里没有正文（choices[0].message.content 是空的）");
    return body.trim();
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error("请求超时");
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
