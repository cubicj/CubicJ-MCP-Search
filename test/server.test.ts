import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test, vi } from "vitest";
import type { BraveClient } from "../src/brave/client.js";
import { createMcpServer, SERVER_INSTRUCTIONS, SERVER_NAME, SERVER_VERSION, type ServerDeps } from "../src/server.js";

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
    expect(observer).toHaveBeenCalledWith(expect.anything(), "results=1");
  });

  test("reports tool_error when web_search has no client", async () => {
    const observer = vi.fn();
    const { client } = await connect({ observer });

    const result = await client.callTool({ name: "web_search", arguments: { query: "coffee" } });

    expect(result.isError).toBe(true);
    expect(observer).toHaveBeenCalledWith(expect.anything(), "tool_error");
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
    expect(observer).toHaveBeenCalledWith(expect.anything(), "tool_error");
  });
});
