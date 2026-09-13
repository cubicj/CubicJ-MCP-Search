import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { normalizeLlmContext } from "../../src/brave/normalize.js";

const fixture = () => JSON.parse(readFileSync(new URL("fixtures/llm-context.json", import.meta.url), "utf8"));

describe("normalizeLlmContext", () => {
  test("keeps generic grounding items with title, url, site, age, and string snippets only", () => {
    expect(normalizeLlmContext(fixture())).toEqual([
      {
        title: "MCP OAuth 2.1: PKCE, Scopes & Token Management",
        url: "https://www.practical-devsecops.com/mcp-oauth-2-1-implementation/",
        site: "www.practical-devsecops.com",
        age: "2026-06-16",
        snippets: [
          "# MCP OAuth 2.1 Security\n#### Key Takeaways\n- OAuth 2.1 is now the MCP auth standard.",
          "## Refresh Token Rotation and the Token Lifecycle\nLong-lived refresh tokens are one of the most commonly exploited weaknesses.",
        ],
      },
      {
        title: "MCP Authentication and Authorization Patterns",
        url: "https://aembit.io/blog/mcp-authentication-and-authorization-patterns/",
        site: "aembit.io",
        snippets: [
          "### OAuth 2.1 Is the Foundation\nShort life spans, refresh token rotation, strict audience validation.",
        ],
      },
    ]);
  });

  test("falls back to the url as title when neither the item nor the source has one", () => {
    const raw = { grounding: { generic: [{ url: "https://x.example", snippets: ["a"] }] }, sources: {} };
    expect(normalizeLlmContext(raw)).toEqual([
      { title: "https://x.example", url: "https://x.example", snippets: ["a"] },
    ]);
  });

  test("returns an empty array for non-object or grounding-less input", () => {
    expect(normalizeLlmContext(null)).toEqual([]);
    expect(normalizeLlmContext("x")).toEqual([]);
    expect(normalizeLlmContext({ sources: {} })).toEqual([]);
    expect(normalizeLlmContext({ grounding: { generic: "nope" } })).toEqual([]);
  });

  test("never emits favicon, thumbnail, description, snippet, poi, or map data", () => {
    const serialized = JSON.stringify(normalizeLlmContext(fixture()));
    for (const forbidden of ["favicon", "thumbnail", "description", "og.webp", "Cafe", "Museum", "Open late"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
