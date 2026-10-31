/**
 * DeepSeek Search — PI-Desktop plugin entry.
 *
 * - Agent tool `web` (search / fetch) backed by the official DeepSeek
 *   Search / Fetch API: https://api-docs.deepseek.com/zh-cn/guides/search
 * - A settings panel (composer toolbar → 打开面板) for the API key and limits.
 *
 * The host injects the global `pi` object. Network access goes through
 * `pi.net.fetch`, limited by manifest.net.domains to api.deepseek.com.
 */

const { runTool, normalizeSettings } = require("./lib/deepseek");

const TOOL_NAME = "web";
const OPEN_COMMAND = "deepseek-search.open";
const PANEL_TITLE = "DeepSeek 联网搜索";

const DESCRIPTION = [
  "Real-time web access via the official DeepSeek Search / Fetch API.",
  "",
  'action="search": search the web. Params: query (required, 1-128 chars), count (1-50),',
  "ori_question (the user's original question, helps intent), need_content (true = also return page body; larger output).",
  "Returns title, URL, site, date, rerank_score (>=1.5 good), authority (>=3 very authoritative) and a long summary per result.",
  'Query operators: site:github.com, -site:x.com, "exact phrase", -word, lang:zh,en, after:2025-01-01, before:2026.',
  "Combine sites with OR, e.g. `DeepSeek site:github.com OR site:huggingface.co`.",
  "",
  'action="fetch": read one page as Markdown. Params: url (required, http/https).',
  "",
  "Use search for current events, recent releases, prices or anything after your training cutoff; then fetch the best URLs",
  "to read details. Always cite source URLs in your answer.",
].join("\n");

const SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["search", "fetch"],
      description: '"search" = web search; "fetch" = read a single URL as Markdown',
    },
    query: { type: "string", description: "search: query text (1-128 chars), search operators allowed" },
    count: { type: "integer", minimum: 1, maximum: 50, description: "search: number of results (default from plugin settings, 8)" },
    ori_question: { type: "string", description: "search: the user's original question (optional, max 128 chars)" },
    need_content: { type: "boolean", description: "search: include full page body for each result (default false)" },
    url: { type: "string", description: "fetch: http(s) URL to read" },
  },
  required: ["action"],
};

function maskKey(key) {
  if (!key) return "";
  return key.length <= 10 ? "••••" : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function viewOf(raw) {
  const s = normalizeSettings(raw);
  return {
    hasKey: Boolean(s.apiKey),
    keyHint: maskKey(s.apiKey),
    defaultCount: s.defaultCount,
    maxChars: s.maxChars,
  };
}

function toolTransport(ctx) {
  return {
    fetchImpl: (input) => pi.net.fetch(input),
    isAborted: () => Boolean(ctx?.signal?.aborted),
  };
}

/** Panel RPC: unknown channels from the panel are forwarded here by the host. */
async function onPanelInvoke(channel, payload) {
  switch (channel) {
    case "ds.get":
      return viewOf(await pi.plugin.getSettings());

    case "ds.save": {
      const current = await pi.plugin.getSettings();
      const next = {};
      if (payload?.clearKey === true) {
        next.apiKey = "";
      } else if (typeof payload?.apiKey === "string" && payload.apiKey.trim()) {
        const key = payload.apiKey.trim();
        if (/\s/.test(key) || key.length < 8) throw new Error("API Key 格式不正确");
        next.apiKey = key;
      }
      if (payload?.defaultCount !== undefined) {
        const n = Number(payload.defaultCount);
        if (!Number.isFinite(n) || n < 1 || n > 50) throw new Error("默认搜索条数需在 1–50 之间");
        next.defaultCount = Math.round(n);
      }
      if (payload?.maxChars !== undefined) {
        const n = Number(payload.maxChars);
        if (!Number.isFinite(n) || n < 2000 || n > 200000) throw new Error("最大字符数需在 2000–200000 之间");
        next.maxChars = Math.round(n);
      }
      await pi.plugin.setSettings(next);
      return viewOf({ ...current, ...next });
    }

    case "ds.test": {
      const current = await pi.plugin.getSettings();
      const typed = typeof payload?.apiKey === "string" ? payload.apiKey.trim() : "";
      const settings = { ...current, ...(typed ? { apiKey: typed } : {}) };
      try {
        const out = await runTool({ action: "search", query: "DeepSeek", count: 1 }, settings, {
          fetchImpl: (input) => pi.net.fetch({ ...input, timeoutMs: 20000 }),
          sleep: async () => {},
        });
        const count = /—\s*(\d+)\s*results/.exec(out)?.[1] ?? "0";
        return { ok: true, count: Number(count) };
      } catch (error) {
        return { ok: false, message: String(error?.message ?? error) };
      }
    }

    default:
      throw new Error(`DeepSeek Search: 不支持的通道「${String(channel)}」`);
  }
}

async function onLoad() {
  await pi.commands.register({
    id: OPEN_COMMAND,
    title: `${PANEL_TITLE}: 打开设置面板`,
    keywords: ["deepseek", "search", "搜索", "api key"],
    run: async () => {
      await pi.ui.openPanel({ title: PANEL_TITLE });
    },
  });

  await pi.agent.registerTool({
    name: TOOL_NAME,
    description: DESCRIPTION,
    risk: "low",
    schema: SCHEMA,
    // Read-only network lookups: safe in Plan / Goal modes on hosts that honour it.
    planSafeActions: ["search", "fetch"],
    execute: async (args, ctx) => {
      const settings = await pi.plugin.getSettings();
      return runTool(args, settings, toolTransport(ctx));
    },
  });
}

async function onUnload() {
  await pi.agent.unregisterTool(TOOL_NAME);
  await pi.commands.unregister(OPEN_COMMAND);
}

module.exports = { onLoad, onUnload, onPanelInvoke };
/**
 * DeepSeek Search — PI-Desktop plugin entry.
 *
 * Registers one agent tool, `web`, backed by the official DeepSeek
 * Search / Fetch API (https://api-docs.deepseek.com/zh-cn/guides/search):
 *   - action "search": POST https://api.deepseek.com/v1/tools/search
 *   - action "fetch":  POST https://api.deepseek.com/v1/tools/fetch
 *
 * The host injects the global `pi` object. Network access goes through
 * `pi.net.fetch`, limited by manifest.net.domains to api.deepseek.com.
 */

const { runTool } = require("./lib/deepseek");

const TOOL_NAME = "web";

const DESCRIPTION = [
  "Real-time web access via the official DeepSeek Search / Fetch API.",
  "",
  'action="search": search the web. Params: query (required, 1-128 chars), count (1-50),',
  "ori_question (the user's original question, helps intent), need_content (true = also return page body; larger output).",
  "Returns title, URL, site, date, rerank_score (>=1.5 good), authority (>=3 very authoritative) and a long summary per result.",
  'Query operators: site:github.com, -site:x.com, "exact phrase", -word, lang:zh,en, after:2025-01-01, before:2026.',
  "Combine sites with OR, e.g. `DeepSeek site:github.com OR site:huggingface.co`.",
  "",
  'action="fetch": read one page as Markdown. Params: url (required, http/https).',
  "",
  "Use search for current events, recent releases, prices or anything after your training cutoff; then fetch the best URLs",
  "to read details. Always cite source URLs in your answer.",
].join("\n");

const SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["search", "fetch"],
      description: '"search" = web search; "fetch" = read a single URL as Markdown',
    },
    query: {
      type: "string",
      description: "search: query text (1-128 chars), search operators allowed",
    },
    count: {
      type: "integer",
      minimum: 1,
      maximum: 50,
      description: "search: number of results (default from plugin settings, 8)",
    },
    ori_question: {
      type: "string",
      description: "search: the user's original question (optional, max 128 chars)",
    },
    need_content: {
      type: "boolean",
      description: "search: include full page body for each result (default false)",
    },
    url: {
      type: "string",
      description: "fetch: http(s) URL to read",
    },
  },
  required: ["action"],
};

async function onLoad() {
  await pi.agent.registerTool({
    name: TOOL_NAME,
    description: DESCRIPTION,
    risk: "low",
    schema: SCHEMA,
    // Read-only network lookups: safe in Plan / Goal modes on hosts that honour it.
    planSafeActions: ["search", "fetch"],
    execute: async (args, ctx) => {
      const settings = await pi.plugin.getSettings();
      return runTool(args, settings, {
        fetchImpl: (input) => pi.net.fetch(input),
        isAborted: () => Boolean(ctx?.signal?.aborted),
      });
    },
  });
}

async function onUnload() {
  await pi.agent.unregisterTool(TOOL_NAME);
}

module.exports = { onLoad, onUnload };
