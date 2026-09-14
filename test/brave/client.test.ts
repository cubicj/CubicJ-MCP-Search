import { describe, expect, test, vi } from "vitest";
import { BraveApiError, BraveRequestError, BraveTimeoutError, createBraveClient } from "../../src/brave/client.js";

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("createBraveClient", () => {
  test("aborts the response body when the status is not ok", async () => {
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementation((_url: unknown, init: { signal: AbortSignal }) => {
      signal = init.signal;
      return Promise.resolve(new Response(new ReadableStream<Uint8Array>(), { status: 429 }));
    });
    const client = createBraveClient({ apiKey: "k", fetch: fetchMock });

    const error = await client.llmContext({ query: "coffee" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BraveApiError);
    expect(signal?.aborted).toBe(true);
  });

  test("sends a GET to /llm/context with the fixed and requested parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ grounding: { generic: [] } }));
    const client = createBraveClient({ apiKey: "secret-key", fetch: fetchMock });

    const raw = await client.llmContext({
      query: "site:example.com refresh token",
      maximum_number_of_urls: 8,
      maximum_number_of_tokens: 8192,
      maximum_number_of_tokens_per_url: 2048,
      freshness: "pw",
      country: "KR",
      search_lang: "ko",
    });

    expect(raw).toEqual({ grounding: { generic: [] } });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.origin + parsed.pathname).toBe("https://api.search.brave.com/res/v1/llm/context");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      q: "site:example.com refresh token",
      maximum_number_of_urls: "8",
      maximum_number_of_tokens: "8192",
      maximum_number_of_tokens_per_url: "2048",
      freshness: "pw",
      country: "KR",
      search_lang: "ko",
      context_threshold_mode: "balanced",
      spellcheck: "false",
    });
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": "secret-key",
    });
  });

  test("omits optional parameters that were not given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({}));
    const client = createBraveClient({ apiKey: "k", fetch: fetchMock });

    await client.llmContext({ query: "coffee" });

    const parsed = new URL(String(fetchMock.mock.calls[0][0]));
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      q: "coffee",
      context_threshold_mode: "balanced",
      spellcheck: "false",
    });
  });

  test("throws BraveApiError with the status and without the response body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("key secret-key rejected", { status: 429 }));
    const client = createBraveClient({ apiKey: "secret-key", fetch: fetchMock });

    const error = await client.llmContext({ query: "coffee" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BraveApiError);
    expect((error as BraveApiError).status).toBe(429);
    expect((error as Error).message).toBe("Brave API status 429");
    expect((error as Error).message).not.toContain("secret-key");
  });

  test("throws BraveTimeoutError when the request exceeds timeoutMs", async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: unknown, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const client = createBraveClient({ apiKey: "k", fetch: fetchMock, timeoutMs: 20 });

    const error = await client.llmContext({ query: "coffee" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BraveTimeoutError);
    expect((error as Error).message).toBe("Brave API timed out after 20ms");
  });

  test("defaults to a 30000ms timeout", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetchMock = vi.fn().mockImplementation(
        (_url: unknown, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal = init.signal;
            init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
      const client = createBraveClient({ apiKey: "k", fetch: fetchMock });
      const pending = client.llmContext({ query: "coffee" }).catch((e: unknown) => e);

      await vi.advanceTimersByTimeAsync(29999);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const error = await pending;

      expect(signal?.aborted).toBe(true);
      expect(error).toBeInstanceOf(BraveTimeoutError);
      expect((error as Error).message).toBe("Brave API timed out after 30000ms");
    } finally {
      vi.useRealTimers();
    }
  });

  test("replaces a malformed JSON body with a fixed message that never echoes the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("leaked secret-key text", { status: 200 }));
    const client = createBraveClient({ apiKey: "secret-key", fetch: fetchMock });

    const error = await client.llmContext({ query: "coffee" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BraveRequestError);
    expect((error as Error).message).toBe("Brave API request failed: invalid JSON");
    expect((error as Error).message).not.toContain("secret-key");
  });

  test("replaces a rejected fetch with a fixed message carrying only the error name", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed secret-key"));
    const client = createBraveClient({ apiKey: "secret-key", fetch: fetchMock });

    const error = await client.llmContext({ query: "coffee" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BraveRequestError);
    expect((error as Error).message).toBe("Brave API request failed: TypeError");
    expect((error as Error).message).not.toContain("secret-key");
  });

  test("classifies a timeout while reading the body as BraveTimeoutError", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: unknown, init: { signal: AbortSignal }) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    const client = createBraveClient({ apiKey: "k", fetch: fetchMock, timeoutMs: 20 });

    const error = await client.llmContext({ query: "coffee" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BraveTimeoutError);
    expect((error as Error).message).toBe("Brave API timed out after 20ms");
  });

  test("honours a custom baseUrl", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({}));
    const client = createBraveClient({ apiKey: "k", fetch: fetchMock, baseUrl: "http://127.0.0.1:9/res/v1" });

    await client.llmContext({ query: "coffee" });

    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^http:\/\/127\.0\.0\.1:9\/res\/v1\/llm\/context\?/);
  });
});
