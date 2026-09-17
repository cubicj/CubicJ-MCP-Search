import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, test, vi } from "vitest";
import type { BraveClient } from "../src/brave/client.js";
import { NO_CONTENT_NOTICE } from "../src/fetch/extractors/generic.js";
import * as fetchDocument from "../src/fetch/fetch.js";
import { createMcpServer, SERVER_INSTRUCTIONS, SERVER_NAME, SERVER_VERSION, type ServerDeps } from "../src/server.js";
import * as fetchTool from "../src/tools/fetch.js";
import * as webSearch from "../src/tools/web-search.js";

const raw = {
  grounding: { generic: [{ title: "Doc", url: "https://docs.example.com", snippets: ["First"] }] },
  sources: {},
};

async function connect(deps: ServerDeps) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(deps);
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return { client, server };
}

describe("createMcpServer", () => {
  test("exposes exactly web_search and fetch with instructions", async () => {
    const { client } = await connect({});
    expect(client.getServerVersion()).toMatchObject({ name: SERVER_NAME, version: SERVER_VERSION });
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect(SERVER_INSTRUCTIONS).toContain("site:");
    expect(SERVER_INSTRUCTIONS).toContain("intitle:");

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["web_search", "fetch"]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
      expect(tool._meta).toEqual({ "anthropic/maxResultSizeChars": 200000 });
      expect(tool.outputSchema).toBeDefined();
    }
  });

  test("routes web_search through the injected Brave client and reports the outcome", async () => {
    const braveClient: BraveClient = { llmContext: vi.fn(async () => raw) };
    const observer = vi.fn();
    const { client } = await connect({ braveClient, observer });

    const result = await client.callTool({ name: "web_search", arguments: { query: "coffee" } });

    expect(braveClient.llmContext).toHaveBeenCalledWith({
      query: "coffee",
      maximum_number_of_urls: 8,
      maximum_number_of_tokens: 8192,
      maximum_number_of_tokens_per_url: 2048,
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      query: "coffee",
      result_count: 1,
      results: [{ title: "Doc", url: "https://docs.example.com", snippets: ["First"] }],
    });
    expect(observer).toHaveBeenCalledWith(expect.anything(), "results=1 snippets=1 chars=5");
  });

  test("tells callers how to handle low search result counts", async () => {
    const { client } = await connect({});
    const { tools } = await client.listTools();
    const description = tools.find((tool) => tool.name === "web_search")?.description;
    expect(description).toContain("count is an upper bound on source URLs (1-20, default 8), not a guarantee");
    expect(description).toContain("Brave returns only sources that pass its relevance threshold");
    expect(description).toContain(
      "If a site:-restricted search returns 2 or fewer results, drop site: and search again, or fetch the site's own listing or search page instead of rephrasing the same site: query.",
    );
  });

  test("directs raw fetches to data endpoints instead of empty-page retries", async () => {
    const { client } = await connect({});
    const { tools } = await client.listTools();
    const description = tools.find((tool) => tool.name === "fetch")?.description;
    expect(description).toContain("raw=true skips extraction and returns the decoded response text");
    expect(description).toContain(
      "use it for JSON, text, or script endpoints, not pages that returned the empty-content notice",
    );
  });

  test("reports tool_error when web_search has no client", async () => {
    const observer = vi.fn();
    const { client } = await connect({ observer });

    const result = await client.callTool({ name: "web_search", arguments: { query: "coffee" } });

    expect(result.isError).toBe(true);
    expect(observer).toHaveBeenCalledWith(
      expect.anything(),
      'tool_error reason="web_search failed: BRAVE_API_KEY is not configured"',
    );
  });

  test("rejects invalid web_search arguments before calling Brave", async () => {
    const braveClient: BraveClient = { llmContext: vi.fn(async () => raw) };
    const { client } = await connect({ braveClient });

    const result = await client.callTool({ name: "web_search", arguments: { query: "coffee", count: 99 } });

    expect(result.isError).toBe(true);
    expect(braveClient.llmContext).not.toHaveBeenCalled();
  });

  test("reports tool_error when fetch fails", async () => {
    const observer = vi.fn();
    const { client } = await connect({ observer });

    const result = await client.callTool({ name: "fetch", arguments: { url: "http://127.0.0.1:9/" } });

    expect(result.isError).toBe(true);
    expect(observer).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/^tool_error reason="Error fetching http:\/\/127\.0\.0\.1:9\/: /),
    );
  });

  test("preserves token redaction in the fetch failure reason", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token-for-log-redaction");
    try {
      vi.spyOn(fetchDocument, "fetchDocument").mockRejectedValueOnce(
        new Error("failed with test-token-for-log-redaction"),
      );
      const observer = vi.fn();
      const { client } = await connect({ observer });
      await client.callTool({ name: "fetch", arguments: { url: "https://x.example", raw: true } });
      expect(observer).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        'tool_error reason="Error fetching https://x.example: failed with [REDACTED]"',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test.each([
    {
      name: "successful extraction",
      structuredContent: { extractor: "defuddle", content: "Hello", metadata: { status: 200 } },
      outcome: "extractor=defuddle http=200 chars=5",
    },
    {
      name: "404 page",
      structuredContent: { extractor: "defuddle", content: "Not found", metadata: { status: 404 } },
      outcome: "extractor=defuddle http=404 chars=9",
    },
    {
      name: "empty-page notice",
      structuredContent: { extractor: "defuddle", content: NO_CONTENT_NOTICE, metadata: { status: 200 } },
      outcome: `extractor=defuddle http=200 chars=${NO_CONTENT_NOTICE.length} notice`,
    },
    {
      name: "notice embedded in real content",
      structuredContent: { extractor: "defuddle", content: `Quoted: ${NO_CONTENT_NOTICE}` },
      outcome: `extractor=defuddle chars=${NO_CONTENT_NOTICE.length + 8}`,
    },
    {
      name: "raw response without metadata",
      structuredContent: { content: "x".repeat(30000) },
      outcome: "extractor=raw chars=30000",
    },
    {
      name: "metadata without status",
      structuredContent: { extractor: "defuddle", content: "Hello", metadata: {} },
      outcome: "extractor=defuddle chars=5",
    },
    {
      name: "non-numeric status",
      structuredContent: { extractor: "defuddle", content: "Hello", metadata: { status: "200" } },
      outcome: "extractor=defuddle chars=5",
    },
    {
      name: "zero status",
      structuredContent: { extractor: "defuddle", content: "", metadata: { status: 0 } },
      outcome: "extractor=defuddle http=0 chars=0",
    },
    { name: "missing structured content", structuredContent: undefined, outcome: "extractor=raw chars=0" },
  ])("reports fetch outcome for $name", async ({ structuredContent, outcome }) => {
    vi.spyOn(fetchTool, "runFetch").mockResolvedValueOnce({ content: [], structuredContent });
    const observer = vi.fn();
    const { client } = await connect({ observer });
    await client.callTool({ name: "fetch", arguments: { url: "https://x.example" } });
    expect(observer).toHaveBeenCalledExactlyOnceWith(expect.anything(), outcome);
  });

  test.each([
    {
      entries: [
        { url: "https://one.example", snippets: ["First", "둘"] },
        { url: "https://two.example", snippets: ["Third"] },
        { url: "https://empty.example", snippets: [] },
      ],
      outcome: "results=3 snippets=3 chars=11",
    },
    { entries: [], outcome: "results=0 snippets=0 chars=0" },
  ])("totals snippets across results: $outcome", async ({ entries, outcome }) => {
    const braveClient: BraveClient = {
      llmContext: vi.fn(async () => ({ grounding: { generic: entries }, sources: {} })),
    };
    const observer = vi.fn();
    const { client } = await connect({ braveClient, observer });
    await client.callTool({ name: "web_search", arguments: { query: "coffee" } });
    expect(observer).toHaveBeenCalledExactlyOnceWith(expect.anything(), outcome);
  });

  test.each<{ name: string; result: CallToolResult; outcome: string }>([
    { name: "missing structured content", result: { content: [] }, outcome: "results=?" },
    {
      name: "no text content",
      result: { isError: true, content: [{ type: "image", data: "", mimeType: "image/png" }] },
      outcome: "tool_error",
    },
    {
      name: "empty text content",
      result: { isError: true, content: [{ type: "text", text: "" }] },
      outcome: 'tool_error reason=""',
    },
    {
      name: "first text after non-text content",
      result: {
        isError: true,
        content: [
          { type: "image", data: "", mimeType: "image/png" },
          { type: "text", text: 'bad\n"reason"\t' },
          { type: "text", text: "ignored" },
        ],
      },
      outcome: 'tool_error reason="bad?\\"reason\\"?"',
    },
    {
      name: "long reason",
      result: { isError: true, content: [{ type: "text", text: "가".repeat(201) }] },
      outcome: `tool_error reason="${"가".repeat(200)}…"`,
    },
  ])("reports $name", async ({ result, outcome }) => {
    vi.spyOn(webSearch, "runWebSearch").mockResolvedValueOnce(result);
    const observer = vi.fn();
    const { client } = await connect({ observer });
    await client.callTool({ name: "web_search", arguments: { query: "coffee" } });
    expect(observer).toHaveBeenCalledExactlyOnceWith(expect.anything(), outcome);
  });
});
