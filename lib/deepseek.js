"use strict";

/**
 * DeepSeek Search / Fetch API client.
 * Docs: https://api-docs.deepseek.com/zh-cn/guides/search
 *
 * Transport-agnostic: `fetchImpl` takes { url, method, headers, body, timeoutMs }
 * and resolves to { status, bodyText } — exactly what PI-Desktop's `pi.net.fetch`
 * returns — so the same code runs inside the plugin host and in plain Node tests.
 */

const BASE_URL = "https://api.deepseek.com";
const SEARCH_URL = `${BASE_URL}/v1/tools/search`;
const FETCH_URL = `${BASE_URL}/v1/tools/fetch`;

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 45_000;

const STATUS_HINTS = {
  400: "请求参数无效 / invalid request",
  401: "API Key 缺失或无效，请在插件设置中检查 DeepSeek API Key / invalid API key",
  402: "DeepSeek 账号余额不足，请充值后重试 / insufficient balance",
  403: "Fetch 请求被安全策略拒绝 / blocked by security policy",
  404: "未能获取可用的网页内容 / no usable page content",
  408: "读取请求体超时 / request timeout",
  413: "请求体过大 / payload too large",
  429: "超过 QPS 限制 / rate limited",
  500: "DeepSeek 服务器内部错误 / server error",
  504: "下游请求超时 / upstream timeout",
};

class DeepSeekError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "DeepSeekError";
    this.status = status;
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    apiKey: typeof s.apiKey === "string" ? s.apiKey.trim() : "",
    defaultCount: clampInt(s.defaultCount, 1, 50, 8),
    maxChars: clampInt(s.maxChars, 2_000, 200_000, 20_000),
  };
}

function truncate(text, limit) {
  const value = String(text ?? "");
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit))}\n…[truncated ${value.length - limit} chars]`;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST a JSON body to a DeepSeek tools endpoint with retry on 408/429/5xx.
 */
async function postJson(endpoint, body, options) {
  const { apiKey, fetchImpl, sleep = defaultSleep, isAborted = () => false } = options;
  if (!apiKey) {
    throw new DeepSeekError(
      "未配置 DeepSeek API Key：请点击输入框下方的「打开面板」→ DeepSeek 联网搜索，填写后保存（获取地址 https://platform.deepseek.com/api_keys）。" +
        " / DeepSeek API key is not configured in the plugin settings."
    );
  }

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await sleep(1000 * 2 ** (attempt - 1));
    }
    if (isAborted()) throw new DeepSeekError("请求已取消 / aborted");

    let res;
    try {
      res = await fetchImpl({
        url: endpoint,
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      // Network / timeout failures: retry. Message never contains the key.
      lastError = new DeepSeekError(`网络请求失败 / network error: ${error?.message ?? error}`);
      continue;
    }

    const status = Number(res?.status ?? 0);
    const data = parseJson(res?.bodyText ?? "");
    if (status === 200) {
      if (data === undefined) throw new DeepSeekError("DeepSeek 返回了无法解析的 JSON / invalid JSON response", status);
      return data;
    }

    const apiMessage = data?.error?.message;
    const hint = STATUS_HINTS[status] ?? "请求失败 / request failed";
    lastError = new DeepSeekError(`HTTP ${status}: ${hint}${apiMessage ? ` — ${apiMessage}` : ""}`, status);
    if (!RETRYABLE.has(status)) throw lastError;
  }
  throw lastError ?? new DeepSeekError("请求失败 / request failed");
}

function validateSearchArgs(args, settings) {
  const query = typeof args?.query === "string" ? args.query.trim() : "";
  if (!query) throw new DeepSeekError("action=search 需要非空的 query 参数 / `query` is required");
  if ([...query].length > 128) {
    throw new DeepSeekError("query 最多 128 个字符，请精简关键词 / `query` must be at most 128 characters");
  }
  const body = {
    query,
    count: clampInt(args?.count, 1, 50, settings.defaultCount),
    need_content: args?.need_content === true,
  };
  if (typeof args?.ori_question === "string" && args.ori_question.trim()) {
    body.ori_question = [...args.ori_question.trim()].slice(0, 128).join("");
  }
  return body;
}

function validateUrl(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) throw new DeepSeekError("action=fetch 需要 url 参数 / `url` is required");
  if (value.length > 8192) throw new DeepSeekError("url 长度不能超过 8192 / `url` is too long");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new DeepSeekError(`无效的 URL / invalid URL: ${value}`);
  }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) {
    throw new DeepSeekError("只支持带 host 的 http/https URL / only http(s) URLs with a host are supported");
  }
  if (parsed.username || parsed.password) {
    throw new DeepSeekError("URL 不能包含用户名或密码 / URL must not contain credentials");
  }
  return value;
}

function formatSearch(query, results, maxChars, includeContent) {
  if (!Array.isArray(results) || results.length === 0) {
    return `DeepSeek Search: "${query}" — no results.`;
  }
  const header = `DeepSeek Search: "${query}" — ${results.length} results (rerank_score ≥ 1.5 = high quality; authority ≥ 3 = highly authoritative)`;
  const perItem = Math.max(400, Math.floor((maxChars - header.length) / results.length));
  const blocks = results.map((item, index) => {
    const meta = [
      item.site_name ? `site: ${item.site_name}` : null,
      item.date ? `date: ${item.date}` : null,
      typeof item.rerank_score === "number" ? `score: ${item.rerank_score}` : null,
      typeof item.authority === "number" && item.authority >= 0 ? `authority: ${item.authority}` : null,
    ].filter(Boolean);
    const lines = [`[${index + 1}] ${item.title || "(untitled)"}`, `URL: ${item.url || ""}`];
    if (meta.length) lines.push(meta.join(" · "));
    const summary = (item.summary || item.snippet || "").trim();
    if (summary) lines.push(summary);
    if (includeContent && item.content) lines.push(`--- content ---\n${item.content.trim()}`);
    return truncate(lines.join("\n"), perItem);
  });
  return truncate([header, ...blocks].join("\n\n"), maxChars);
}

function formatFetch(url, page, maxChars) {
  const title = page?.title ? String(page.title) : "(untitled)";
  const content = String(page?.content ?? "").trim() || "(empty page)";
  return truncate(`# ${title}\nSource: ${url}\n\n${content}`, maxChars);
}

async function runSearch(args, settings, transport) {
  const body = validateSearchArgs(args, settings);
  const data = await postJson(SEARCH_URL, body, { apiKey: settings.apiKey, ...transport });
  return formatSearch(body.query, data?.results, settings.maxChars, body.need_content);
}

async function runFetch(args, settings, transport) {
  const url = validateUrl(args?.url);
  const data = await postJson(FETCH_URL, { url }, { apiKey: settings.apiKey, ...transport });
  return formatFetch(url, data, settings.maxChars);
}

/**
 * Entry point used by the agent tool.
 * @param {object} args tool arguments ({ action, query, count, ori_question, need_content, url })
 * @param {object} rawSettings plugin settings
 * @param {{ fetchImpl: Function, sleep?: Function, isAborted?: Function }} transport
 */
async function runTool(args, rawSettings, transport) {
  const settings = normalizeSettings(rawSettings);
  const action = args?.action;
  if (action === "search") return runSearch(args, settings, transport);
  if (action === "fetch") return runFetch(args, settings, transport);
  throw new DeepSeekError('action 必须是 "search" 或 "fetch" / `action` must be "search" or "fetch"');
}

module.exports = {
  SEARCH_URL,
  FETCH_URL,
  DeepSeekError,
  normalizeSettings,
  validateSearchArgs,
  validateUrl,
  formatSearch,
  formatFetch,
  postJson,
  runTool,
};
