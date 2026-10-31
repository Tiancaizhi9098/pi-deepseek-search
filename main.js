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
