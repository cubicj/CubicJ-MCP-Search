import { once } from "node:events";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { fetchAnnotations, fetchInputSchema, fetchMeta, runFetch } from "../../src/tools/fetch.js";

let baseUrl = "";
const server = createServer((req, res) => {
  if (req.url === "/raw") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("0123456789abcdefghijklmnopqrstuvwxyz");
    return;
  }
  if (req.url === "/article") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      "<!doctype html><html><head><title>Fixture Title</title></head><body><main><p>Fixture body text.</p></main></body></html>",
    );
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

const textOf = (result: { content: Array<{ type: string; text?: string }> }): string => result.content[0]?.text ?? "";

describe("fetch schema", () => {
  test("applies the defuddle defaults", () => {
    expect(z.object(fetchInputSchema).parse({ url: "https://example.com" })).toEqual({
      url: "https://example.com",
      max_length: 50000,
      start_index: 0,
      raw: false,
    });
    expect(z.object(fetchInputSchema).safeParse({ url: "not a url" }).success).toBe(false);
    expect(fetchAnnotations.readOnlyHint).toBe(true);
    expect(fetchMeta).toEqual({ "anthropic/maxResultSizeChars": 200000 });
  });
});

describe("runFetch", () => {
  test("raw mode slices by start_index and max_length with a truncation notice", async () => {
    const result = await runFetch({ url: `${baseUrl}/raw`, raw: true, start_index: 10, max_length: 5 });
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe("abcde\n\n[Truncated. Total length: 36 characters. Continue with start_index=15.]");
    expect(result.structuredContent).toEqual({
      url: `${baseUrl}/raw`,
      title: "Untitled",
      mode: "raw",
      content: "abcde",
      start_index: 10,
      max_length: 5,
      total_length: 36,
    });
  });

  test("markdown mode returns the extracted title, defuddle extractor, and status metadata", async () => {
    const result = await runFetch({ url: `${baseUrl}/article`, raw: false, start_index: 0, max_length: 50000 });
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as {
      title: string;
      mode: string;
      extractor: string;
      content: string;
      metadata: { status: number };
    };
    expect(sc.title).toBe("Fixture Title");
    expect(sc.mode).toBe("markdown");
    expect(sc.extractor).toBe("defuddle");
    expect(sc.content).toContain("Fixture body text.");
    expect(sc.metadata.status).toBe(200);
    expect(textOf(result)).toMatch(/^# Fixture Title\n\n\*\*URL\*\*: /);
  });

  test("reports unreachable URLs as MCP errors", async () => {
    const result = await runFetch({ url: "http://127.0.0.1:9/", raw: false, start_index: 0, max_length: 50000 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Error fetching http:\/\/127\.0\.0\.1:9\//);
  });
});
