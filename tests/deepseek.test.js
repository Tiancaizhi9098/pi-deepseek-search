"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runTool, SEARCH_URL, FETCH_URL, normalizeSettings } = require("../lib/deepseek");

const KEY = "sk-test-0000000000";

function mockTransport(responses) {
  const calls = [];
  const queue = [...responses];
  return {
    calls,
    transport: {
      sleep: async () => {},
      fetchImpl: async (input) => {
        calls.push(input);
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return { status: next.status, bodyText: JSON.stringify(next.body) };
      },
    },
  };
}

test("search sends the documented request and formats results", async () => {
  const { calls, transport } = mockTransport([
    {
      status: 200,
      body: {
        results: [
          {
            rerank_score: 2.4,
            title: "DeepSeek V4",
            url: "https://example.com/v4",
            snippet: "short",
            summary: "long summary",
            content: "",
            site_name: "Example",
            date: "2026-06-01T00:00:00+00:00",
            authority: 3,
          },
        ],
      },
    },
  ]);
  const out = await runTool(
    { action: "search", query: "  DeepSeek V4  ", count: 5, ori_question: "what is new?" },
    { apiKey: KEY },
    transport
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SEARCH_URL);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(calls[0].body), {
    query: "DeepSeek V4",
    count: 5,
    need_content: false,
    ori_question: "what is new?",
  });
  assert.match(out, /\[1\] DeepSeek V4/);
  assert.match(out, /URL: https:\/\/example\.com\/v4/);
  assert.match(out, /long summary/);
  assert.match(out, /authority: 3/);
});

test("search uses default count from settings and clamps it", async () => {
  const { calls, transport } = mockTransport([{ status: 200, body: { results: [] } }]);
  const out = await runTool({ action: "search", query: "x" }, { apiKey: KEY, defaultCount: 99 }, transport);
  assert.equal(JSON.parse(calls[0].body).count, 50);
  assert.match(out, /no results/);
});

test("fetch posts the url and returns markdown", async () => {
  const { calls, transport } = mockTransport([
    { status: 200, body: { title: "Example", content: "# Example\n\nBody." } },
  ]);
  const out = await runTool({ action: "fetch", url: "https://example.com/a" }, { apiKey: KEY }, transport);
  assert.equal(calls[0].url, FETCH_URL);
  assert.deepEqual(JSON.parse(calls[0].body), { url: "https://example.com/a" });
  assert.match(out, /^# Example\nSource: https:\/\/example\.com\/a/);
  assert.match(out, /Body\./);
});

test("missing API key fails before any request", async () => {
  const { calls, transport } = mockTransport([]);
  await assert.rejects(runTool({ action: "search", query: "x" }, {}, transport), /API Key/);
  assert.equal(calls.length, 0);
});

test("argument validation", async () => {
  const { calls, transport } = mockTransport([]);
  const s = { apiKey: KEY };
  await assert.rejects(runTool({ action: "search", query: "   " }, s, transport), /query/);
  await assert.rejects(runTool({ action: "search", query: "a".repeat(129) }, s, transport), /128/);
  await assert.rejects(runTool({ action: "fetch", url: "ftp://x.com" }, s, transport), /http/);
  await assert.rejects(runTool({ action: "fetch", url: "https://u:p@x.com" }, s, transport), /credentials/);
  await assert.rejects(runTool({ action: "nope" }, s, transport), /action/);
  assert.equal(calls.length, 0);
});

test("retries 429/5xx then succeeds", async () => {
  const { calls, transport } = mockTransport([
    { status: 429, body: { error: { message: "slow down" } } },
    { status: 503, body: {} },
    { status: 200, body: { results: [] } },
  ]);
  await runTool({ action: "search", query: "x" }, { apiKey: KEY }, transport);
  assert.equal(calls.length, 3);
});

test("does not retry 4xx and surfaces API message without the key", async () => {
  const { calls, transport } = mockTransport([
    { status: 401, body: { error: { message: "Authentication Fails" } } },
  ]);
  await assert.rejects(
    runTool({ action: "search", query: "x" }, { apiKey: KEY }, transport),
    (error) => {
      assert.match(error.message, /HTTP 401/);
      assert.match(error.message, /Authentication Fails/);
      assert.ok(!error.message.includes(KEY));
      return true;
    }
  );
  assert.equal(calls.length, 1);
});

test("output is capped by maxChars", async () => {
  const big = "x".repeat(50_000);
  const { transport } = mockTransport([{ status: 200, body: { title: "T", content: big } }]);
  const out = await runTool({ action: "fetch", url: "https://e.com" }, { apiKey: KEY, maxChars: 3000 }, transport);
  assert.ok(out.length < 3100, `length ${out.length}`);
  assert.match(out, /truncated/);
});

test("normalizeSettings defaults", () => {
  assert.deepEqual(normalizeSettings(undefined), { apiKey: "", defaultCount: 8, maxChars: 20000 });
});
