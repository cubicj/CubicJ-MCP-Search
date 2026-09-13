import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, RequestId } from "@modelcontextprotocol/sdk/types.js";
import type { BraveClient } from "./brave/client.js";
import {
  type FetchArgs,
  fetchAnnotations,
  fetchDescription,
  fetchInputSchema,
  fetchMeta,
  fetchOutputSchema,
  runFetch,
} from "./tools/fetch.js";
import {
  runWebSearch,
  type WebSearchArgs,
  webSearchAnnotations,
  webSearchDescription,
  webSearchInputSchema,
  webSearchMeta,
  webSearchOutputSchema,
} from "./tools/web-search.js";

const packageJson = createRequire(import.meta.url)("../package.json") as { version: string };

export const SERVER_NAME = "cubicj-mcp-search";
export const SERVER_VERSION = packageJson.version;

export const SERVER_INSTRUCTIONS =
  "Web research connector with two read-only tools. " +
  "Use web_search first for any question about the public web: facts, current events, documentation, prices, or finding URLs; " +
  "it returns page excerpts per source, so read them before deciding whether a full fetch is needed. " +
  "Use fetch to read one specific URL in full: articles, docs, GitHub files and issues, PDFs, Korean communities (DCInside, Clien, Ruliweb, FMKorea, namu.wiki), Naver Blog, Bluesky. " +
  "Page long content with start_index. Search operators use a colon (site:example.com).";

export type ToolObserver = (requestId: RequestId, outcome: string) => void;

export interface ServerDeps {
  braveClient?: BraveClient;
  observer?: ToolObserver;
}

function webSearchOutcome(result: CallToolResult): string {
  const count = result.structuredContent?.result_count;
  return typeof count === "number" ? `results=${count}` : "results=?";
}

function fetchOutcome(result: CallToolResult): string {
  const sc = result.structuredContent ?? {};
  const extractor = typeof sc.extractor === "string" ? sc.extractor : "raw";
  const chars = typeof sc.content === "string" ? sc.content.length : 0;
  return `extractor=${extractor} chars=${chars}`;
}

export function createMcpServer(deps: ServerDeps = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });

  const observe = (requestId: RequestId, result: CallToolResult, outcome: (r: CallToolResult) => string): void => {
    deps.observer?.(requestId, result.isError ? "tool_error" : outcome(result));
  };

  server.registerTool(
    "web_search",
    {
      title: "Web Search",
      description: webSearchDescription,
      inputSchema: webSearchInputSchema,
      outputSchema: webSearchOutputSchema,
      annotations: webSearchAnnotations,
      _meta: webSearchMeta,
    },
    async (args, extra) => {
      const result = await runWebSearch(deps.braveClient, args as WebSearchArgs);
      observe(extra.requestId, result, webSearchOutcome);
      return result;
    },
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch URL",
      description: fetchDescription,
      inputSchema: fetchInputSchema,
      outputSchema: fetchOutputSchema,
      annotations: fetchAnnotations,
      _meta: fetchMeta,
    },
    async (args, extra) => {
      const result = await runFetch(args as FetchArgs);
      observe(extra.requestId, result, fetchOutcome);
      return result;
    },
  );

  return server;
}
