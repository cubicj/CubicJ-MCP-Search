import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BraveApiError, type BraveClient, BraveRequestError, BraveTimeoutError } from "../brave/client.js";
import { normalizeLlmContext } from "../brave/normalize.js";

export const webSearchDescription =
  "Search the web and get relevance-ranked page excerpts for each result, ready to read and cite. " +
  "First tool for any research, fact lookup, or URL discovery; most questions need one call and no follow-up fetch. " +
  'Operators use a colon: site:example.com, "exact phrase", -excluded. ' +
  "count sets how many source URLs (1-20, default 8); max_tokens caps the total excerpt size (1024-32768, default 8192); " +
  "freshness limits results by date (pd, pw, pm, py, or YYYY-MM-DDtoYYYY-MM-DD); country and search_lang scope the market. " +
  "Returns JSON: query, result_count, results[{title, url, site, age, snippets[]}].";

export const webSearchInputSchema = {
  query: z.string().min(1).max(400).describe("Search query; operators use a colon (site:example.com)"),
  count: z.number().int().min(1).max(20).default(8).describe("Number of source URLs to return"),
  freshness: z
    .string()
    .optional()
    .describe("Date filter: pd (day), pw (week), pm (month), py (year), or YYYY-MM-DDtoYYYY-MM-DD"),
  country: z.string().optional().describe("Two-letter country code, e.g. KR, US"),
  search_lang: z.string().optional().describe("Search language code, e.g. ko, en"),
  max_tokens: z.number().int().min(1024).max(32768).default(8192).describe("Cap on total excerpt tokens"),
};

export const webSearchOutputSchema = {
  query: z.string(),
  result_count: z.number().int().min(0),
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      site: z.string().optional(),
      age: z.string().optional(),
      snippets: z.array(z.string()),
    }),
  ),
};

export const webSearchAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} satisfies ToolAnnotations;

export const webSearchMeta = { "anthropic/maxResultSizeChars": 200000 } as const;

export interface WebSearchArgs {
  query: string;
  count: number;
  freshness?: string;
  country?: string;
  search_lang?: string;
  max_tokens: number;
}

function reasonOf(error: unknown): string {
  if (error instanceof BraveApiError || error instanceof BraveTimeoutError || error instanceof BraveRequestError) {
    return error.message;
  }
  return `unexpected ${error instanceof Error ? error.name : "error"}`;
}

function failure(reason: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: `web_search failed: ${reason}` }] };
}

export async function runWebSearch(client: BraveClient | undefined, args: WebSearchArgs): Promise<CallToolResult> {
  if (!client) return failure("BRAVE_API_KEY is not configured");

  try {
    const raw = await client.llmContext({
      query: args.query,
      maximum_number_of_urls: args.count,
      maximum_number_of_tokens: args.max_tokens,
      ...(args.freshness !== undefined ? { freshness: args.freshness } : {}),
      ...(args.country !== undefined ? { country: args.country } : {}),
      ...(args.search_lang !== undefined ? { search_lang: args.search_lang } : {}),
    });
    const results = normalizeLlmContext(raw);
    const payload = { query: args.query, result_count: results.length, results };
    return { structuredContent: payload, content: [{ type: "text", text: JSON.stringify(payload) }] };
  } catch (error) {
    return failure(reasonOf(error));
  }
}
