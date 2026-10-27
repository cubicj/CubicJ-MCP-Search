import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { BraveApiError, type BraveClient, BraveRequestError, BraveTimeoutError } from "../../src/brave/client.js";
import {
  runWebSearch,
  webSearchAnnotations,
  webSearchDescription,
  webSearchInputSchema,
  webSearchMeta,
  webSearchOutputSchema,
} from "../../src/tools/web-search.js";

const raw = {
  grounding: {
    generic: [{ title: "Doc", url: "https://docs.example.com", snippets: ["First", "Second"] }],
  },
  sources: { "https://docs.example.com": { hostname: "docs.example.com", age: ["2026-01-02"] } },
};

const client = (impl: BraveClient["llmContext"]): BraveClient => ({ llmContext: vi.fn(impl) });

const textOf = (result: { content: Array<{ type: string; text?: string }> }): string => result.content[0]?.text ?? "";

describe("web_search schema", () => {
  test("applies defaults and bounds", () => {
    const schema = z.object(webSearchInputSchema);
    expect(schema.parse({ query: "coffee" })).toEqual({ query: "coffee", count: 8, max_tokens: 8192 });
    expect(schema.safeParse({ query: "" }).success).toBe(false);
    expect(schema.safeParse({ query: "x".repeat(401) }).success).toBe(false);
    expect(schema.safeParse({ query: "coffee", count: 21 }).success).toBe(false);
    expect(schema.safeParse({ query: "coffee", max_tokens: 1000 }).success).toBe(false);
  });

  test("validates country and language against the supported markets", () => {
    const schema = z.object(webSearchInputSchema);
    expect(schema.safeParse({ query: "coffee", country: "XX" }).success).toBe(false);
    expect(schema.safeParse({ query: "coffee", search_lang: "xx" }).success).toBe(false);
    expect(schema.safeParse({ query: "coffee", country: "KR", search_lang: "ko" }).success).toBe(true);
    expect(schema.safeParse({ query: "coffee", country: "ALL" }).success).toBe(true);
  });

  test("describes search operators and research budgets", () => {
    expect(webSearchDescription).toContain("intitle:");
    expect(webSearchDescription).toContain("AND");
    expect(webSearchDescription).toContain("16384");
  });

  test("declares the output shape and read-only annotations", () => {
    const schema = z.object(webSearchOutputSchema);
    expect(
      schema.safeParse({ query: "q", result_count: 1, results: [{ title: "t", url: "u", snippets: [] }] }).success,
    ).toBe(true);
    expect(webSearchAnnotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(webSearchMeta).toEqual({ "anthropic/maxResultSizeChars": 200000 });
  });
});

describe("runWebSearch", () => {
  test("maps arguments to Brave parameters and shapes the result", async () => {
    const c = client(async () => raw);
    const result = await runWebSearch(c, {
      query: "site:example.com coffee",
      count: 5,
      freshness: "pm",
      country: "KR",
      search_lang: "ko",
      max_tokens: 4096,
    });

    expect(c.llmContext).toHaveBeenCalledWith({
      query: "site:example.com coffee",
      maximum_number_of_urls: 5,
      maximum_number_of_tokens: 4096,
      maximum_number_of_tokens_per_url: 1640,
      freshness: "pm",
      country: "KR",
      search_lang: "ko",
    });
    const expected = {
      query: "site:example.com coffee",
      result_count: 1,
      results: [
        {
          title: "Doc",
          url: "https://docs.example.com",
          site: "docs.example.com",
          age: "2026-01-02",
          snippets: ["First", "Second"],
        },
      ],
    };
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(expected);
    expect(textOf(result)).toBe(JSON.stringify(expected));
  });

  test("caps results at count when Brave returns more sources", async () => {
    const generic = Array.from({ length: 10 }, (_, i) => ({ url: `https://example.com/${i}`, snippets: [`s${i}`] }));
    const c = client(async () => ({ grounding: { generic } }));
    const result = await runWebSearch(c, { query: "coffee", count: 3, max_tokens: 2048 });

    const payload = result.structuredContent as { result_count: number; results: Array<{ url: string }> };
    expect(payload.result_count).toBe(3);
    expect(payload.results.map((r) => r.url)).toEqual([
      "https://example.com/0",
      "https://example.com/1",
      "https://example.com/2",
    ]);
  });

  test("does not send optional parameters that are absent", async () => {
    const c = client(async () => raw);
    await runWebSearch(c, { query: "coffee", count: 8, max_tokens: 8192 });
    expect(c.llmContext).toHaveBeenCalledWith({
      query: "coffee",
      maximum_number_of_urls: 8,
      maximum_number_of_tokens: 8192,
      maximum_number_of_tokens_per_url: 2048,
    });
  });

  test("reports a missing API key without calling Brave", async () => {
    const result = await runWebSearch(undefined, { query: "coffee", count: 8, max_tokens: 8192 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("web_search failed: BRAVE_API_KEY is not configured");
  });

  test("reports API status, timeout, and unexpected errors as one line each", async () => {
    const status = await runWebSearch(
      client(async () => {
        throw new BraveApiError(429);
      }),
      { query: "c", count: 8, max_tokens: 8192 },
    );
    expect(status.isError).toBe(true);
    expect(textOf(status)).toBe("web_search failed: Brave API status 429");

    const timeout = await runWebSearch(
      client(async () => {
        throw new BraveTimeoutError(15000);
      }),
      { query: "c", count: 8, max_tokens: 8192 },
    );
    expect(textOf(timeout)).toBe("web_search failed: Brave API timed out after 15000ms");

    const request = await runWebSearch(
      client(async () => {
        throw new BraveRequestError("invalid JSON");
      }),
      { query: "c", count: 8, max_tokens: 8192 },
    );
    expect(textOf(request)).toBe("web_search failed: Brave API request failed: invalid JSON");

    const other = await runWebSearch(
      client(async () => {
        throw new Error('socket hang up BRAVE_API_KEY="synthetic-secret"\nX-Subscription-Token: abc123');
      }),
      { query: "c", count: 8, max_tokens: 8192 },
    );
    expect(textOf(other)).toBe("web_search failed: unexpected Error");
    expect(textOf(other)).not.toContain("synthetic-secret");
    expect(textOf(other)).not.toContain("abc123");
    expect(textOf(other)).not.toContain("\n");
  });
});
