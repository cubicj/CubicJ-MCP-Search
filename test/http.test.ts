import { request as nodeRequest, type Server } from "node:http";
import { connect } from "node:net";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { BraveClient } from "../src/brave/client.js";
import { NO_CONTENT_NOTICE } from "../src/fetch/extractors/generic.js";
import * as registry from "../src/fetch/extractors/registry.js";
import { createHttpServer, describeRequest } from "../src/http.js";
import { SERVER_INSTRUCTIONS } from "../src/server.js";

const raw = {
  grounding: { generic: [{ title: "Doc", url: "https://docs.example.com", snippets: ["First"] }] },
  sources: {},
};

const servers: Server[] = [];

async function listen(deps = {}): Promise<number> {
  const server = createHttpServer(deps);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  return address.port;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const rpc = async (port: number, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { accept: "application/json, text/event-stream", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const modernRpc = (
  port: number,
  method: string,
  params: Record<string, unknown> = {},
  id: string | number = 1,
  headers: Record<string, string> = {},
) =>
  rpc(
    port,
    {
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "http-test", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    },
    {
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(typeof params.name === "string" ? { "mcp-name": params.name } : {}),
      ...headers,
    },
  );

describe("describeRequest", () => {
  test("replaces control characters in method and tool names so a label is one line", () => {
    expect(describeRequest({ method: "tools/call", params: { name: "bad\nforged", arguments: {} } })).toBe(
      "tools/call bad?forged",
    );
    expect(describeRequest({ method: "bad\r\nmethod" })).toBe("bad??method");
  });

  test("labels tools/call with the query or url", () => {
    expect(
      describeRequest({ method: "tools/call", params: { name: "web_search", arguments: { query: "coffee" } } }),
    ).toBe('tools/call web_search q="coffee"');
    expect(
      describeRequest({ method: "tools/call", params: { name: "fetch", arguments: { url: "https://x.example/a" } } }),
    ).toBe('tools/call fetch url="https://x.example/a"');
    expect(describeRequest({ method: "tools/list" })).toBe("tools/list");
    expect(describeRequest("nope")).toBe("unknown");
  });

  test("truncates long values at 200 characters and escapes quotes", () => {
    const label = describeRequest({
      method: "tools/call",
      params: { name: "web_search", arguments: { query: "가".repeat(201) } },
    });
    expect(label).toBe(`tools/call web_search q="${"가".repeat(200)}…"`);
    expect(describeRequest({ method: "tools/call", params: { name: "fetch", arguments: { url: 'a"b' } } })).toBe(
      'tools/call fetch url="a\\"b"',
    );
  });

  test("joins batch entries with commas", () => {
    expect(describeRequest([{ method: "initialize" }, { method: "tools/list" }])).toBe("initialize,tools/list");
  });

  test("appends extra scalar arguments in client order after query and url", () => {
    expect(
      describeRequest({
        method: "tools/call",
        params: {
          name: "web_search",
          arguments: { count: 20, query: "coffee", max_tokens: 16384, freshness: "pw", country: "KR" },
        },
      }),
    ).toBe('tools/call web_search q="coffee" count=20 max_tokens=16384 freshness="pw" country="KR"');
    expect(
      describeRequest({
        method: "tools/call",
        params: {
          name: "fetch",
          arguments: { start_index: 50000, url: "https://x", raw: true, max_length: 0, flag: false },
        },
      }),
    ).toBe('tools/call fetch url="https://x" start_index=50000 raw=true max_length=0 flag=false');
  });

  test("skips objects, arrays, null, undefined, and duplicate query and url fields", () => {
    expect(
      describeRequest({
        method: "tools/call",
        params: {
          name: "fetch",
          arguments: {
            query: "coffee",
            url: "https://x",
            object: { secret: "hidden" },
            array: ["hidden"],
            nil: null,
            missing: undefined,
            raw: true,
          },
        },
      }),
    ).toBe('tools/call fetch q="coffee" url="https://x" raw=true');
  });

  test("sanitizes argument keys and values and clips extra strings", () => {
    expect(
      describeRequest({
        method: "tools/call",
        params: {
          name: "web_search",
          arguments: { query: "cof\nfee", "bad\r\n\t\x7fkey": 'a"b\n', extra: "가".repeat(201) },
        },
      }),
    ).toBe(`tools/call web_search q="cof?fee" bad????key="a\\"b?" extra="${"가".repeat(200)}…"`);
  });
});

describe("createHttpServer", () => {
  test("serves modern discover with public one-hour cache hints", async () => {
    const port = await listen();
    const response = await modernRpc(port, "server/discover");
    expect(response.status).toBe(200);
    const { result } = await response.json();
    expect(result.supportedVersions).toEqual(["2026-07-28"]);
    expect(result._meta["io.modelcontextprotocol/serverInfo"]).toMatchObject({
      name: "cubicj-mcp-search",
      version: "0.2.0",
    });
    expect(result.instructions).toBe(SERVER_INSTRUCTIONS);
    expect(result).toMatchObject({ ttlMs: 3600000, cacheScope: "public" });
  });

  test("lists modern tools without a handshake with public one-hour cache hints", async () => {
    const port = await listen();
    const response = await modernRpc(port, "tools/list");
    expect(response.status).toBe(200);
    const { result } = await response.json();
    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual(["web_search", "fetch"]);
    expect(result).toMatchObject({ ttlMs: 3600000, cacheScope: "public" });
  });

  test("routes malformed JSON-RPC objects to the modern rejection", async () => {
    const port = await listen();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await rpc(port, {});
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32600, message: "Bad Request: the request body is not a valid JSON-RPC message" },
      id: null,
    });
    await vi.waitFor(() =>
      expect(spy).toHaveBeenCalledExactlyOnceWith(
        expect.stringMatching(/^Request unknown: \d+ms status=400 era=2026 client="node"$/),
      ),
    );
  });

  test.each(["2025", "2026"])("logs the routed era %s and a sanitized, clipped User-Agent", async (era) => {
    const port = await listen();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const headers = { "user-agent": `agent\t${"x".repeat(294)}` };
    const response =
      era === "2026"
        ? await modernRpc(port, "tools/list", {}, 1, headers)
        : await rpc(port, { jsonrpc: "2.0", id: 1, method: "tools/list" }, headers);
    expect(response.status).toBe(200);
    await response.text();
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(String(spy.mock.calls[0][0]).replace(/\d+ms/, "TIME")).toBe(
      `Request tools/list: TIME status=200 era=${era} client="agent?${"x".repeat(194)}…"`,
    );
  });

  test("logs a missing User-Agent as a dash", async () => {
    const port = await listen();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = nodeRequest(
        {
          hostname: "127.0.0.1",
          port,
          path: "/mcp",
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    });
    expect(status).toBe(200);
    await vi.waitFor(() =>
      expect(spy).toHaveBeenCalledExactlyOnceWith(
        expect.stringMatching(/^Request tools\/list: \d+ms status=200 era=2025 client="-"$/),
      ),
    );
  });

  test.each(["2025-11-25", "2026-07-28"])(
    "preserves front responses and exact pre-routing logs for %s",
    async (version) => {
      const port = await listen();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const headers = { "mcp-protocol-version": version };
      for (const origin of ["", "https://evil.example"]) {
        const forbidden = await rpc(port, {}, { ...headers, origin });
        expect(forbidden.status).toBe(403);
        expect(await forbidden.json()).toEqual({ error: "Forbidden" });
      }
      const method = await fetch(`http://127.0.0.1:${port}/mcp`, { headers });
      expect(method.status).toBe(405);
      expect(method.headers.get("allow")).toBe("POST");
      expect(await method.json()).toEqual({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
      });
      const huge = await rpc(port, "x".repeat(1024 * 1024 + 1), headers);
      expect(huge.status).toBe(413);
      expect(await huge.json()).toEqual({
        jsonrpc: "2.0",
        error: { code: -32600, message: "Request body exceeds 1048576 bytes" },
        id: null,
      });
      const invalid = await rpc(port, "{not json", headers);
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
        id: null,
      });
      await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(5));
      expect(spy.mock.calls.map(([line]) => String(line).replace(/\d+ms/, "TIME"))).toEqual([
        "Request unknown: TIME status=403",
        "Request unknown: TIME status=403",
        "Request unknown: TIME status=405",
        "Request unknown: TIME status=413",
        "Request unknown: TIME status=400",
      ]);
    },
  );

  test("keeps empty bodies on the legacy error path", async () => {
    const port = await listen();
    const response = await rpc(port, "");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32700, message: "Parse error: Invalid JSON" },
      id: null,
    });
  });

  test.each(["2025", "2026"])("advertises result size limits over HTTP era %s", async (era) => {
    const port = await listen();
    const response =
      era === "2026"
        ? await modernRpc(port, "tools/list")
        : await rpc(port, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.status).toBe(200);
    const { result } = await response.json();
    expect(
      result.tools.map((tool: { name: string; _meta: Record<string, unknown> }) => ({
        name: tool.name,
        maxResultSizeChars: tool._meta["anthropic/maxResultSizeChars"],
      })),
    ).toEqual([
      { name: "web_search", maxResultSizeChars: 200000 },
      { name: "fetch", maxResultSizeChars: 500000 },
    ]);
  });

  test("calls modern tools without a handshake with legacy content parity and outcomes", async () => {
    const braveClient: BraveClient = { llmContext: vi.fn(async () => raw) };
    const port = await listen({ braveClient });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const params = { name: "web_search", arguments: { query: "coffee" } };
    const modern = await modernRpc(port, "tools/call", params);
    expect(modern.status).toBe(200);
    const modernBody = await modern.json();
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Request tools\/call web_search q="coffee": \d+ms status=200 era=2026 client="node" results=1 snippets=1 chars=5$/,
      ),
    );
    const legacy = await rpc(port, { jsonrpc: "2.0", id: 2, method: "tools/call", params });
    expect(modernBody.result.structuredContent).toEqual((await legacy.json()).result.structuredContent);
    expect(modernBody.result.structuredContent.result_count).toBe(1);
  });

  test("closes transport and server exactly once when the client disconnects mid-request", async () => {
    const started = Promise.withResolvers<void>();
    const pending = Promise.withResolvers<typeof raw>();
    const braveClient: BraveClient = {
      llmContext: vi.fn(() => {
        started.resolve();
        return pending.promise;
      }),
    };
    const transportClose = vi.spyOn(NodeStreamableHTTPServerTransport.prototype, "close");
    const serverClose = vi.spyOn(McpServer.prototype, "close");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const port = await listen({ braveClient });
    const controller = new AbortController();
    const response = fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "disconnect",
        method: "tools/call",
        params: { name: "web_search", arguments: { query: "coffee" } },
      }),
    }).catch((error: unknown) => error);
    try {
      await started.promise;
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(transportClose).not.toHaveBeenCalled();
      expect(serverClose).not.toHaveBeenCalled();
      controller.abort();
      await response;
      await vi.waitFor(() => {
        expect(transportClose).toHaveBeenCalledTimes(1);
        expect(serverClose).toHaveBeenCalledTimes(1);
      });
      expect(log).toHaveBeenCalledExactlyOnceWith(
        expect.stringMatching(
          /^Request tools\/call web_search q="coffee": \d+ms aborted status=200 era=2025 client="node" rejected$/,
        ),
      );
      pending.resolve(raw);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(transportClose).toHaveBeenCalledTimes(1);
      expect(serverClose).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      controller.abort();
      pending.resolve(raw);
      await response;
    }
  });

  test("returns the existing JSON-RPC error and closes once when handling throws before writing", async () => {
    vi.spyOn(NodeStreamableHTTPServerTransport.prototype, "handleRequest").mockRejectedValueOnce(
      new Error("handler failed"),
    );
    const transportClose = vi.spyOn(NodeStreamableHTTPServerTransport.prototype, "close");
    const serverClose = vi.spyOn(McpServer.prototype, "close");
    const port = await listen();
    const response = await rpc(port, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32603, message: "handler failed" },
      id: null,
    });
    await vi.waitFor(() => {
      expect(transportClose).toHaveBeenCalledTimes(1);
      expect(serverClose).toHaveBeenCalledTimes(1);
    });
  });

  test.each(["2025-06-18", "2025-11-25"])(
    "preserves JSON responses and notification acceptance for %s",
    async (protocolVersion) => {
      const braveClient: BraveClient = { llmContext: vi.fn(async () => raw) };
      const port = await listen({ braveClient });
      const headers = { "mcp-protocol-version": protocolVersion };
      const init = await rpc(
        port,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion, capabilities: {}, clientInfo: { name: "parity", version: "1" } },
        },
        headers,
      );
      expect(init.status).toBe(200);
      expect(init.headers.get("content-type")).toBe("application/json");
      const initResult = (await init.json()).result;
      expect(initResult.protocolVersion).toBe(protocolVersion);
      expect(JSON.stringify(initResult)).not.toMatch(/"(?:ttlMs|cacheScope)"\s*:/);
      const initialized = await rpc(port, { jsonrpc: "2.0", method: "notifications/initialized" }, headers);
      expect(initialized.status).toBe(202);
      const list = await rpc(port, { jsonrpc: "2.0", id: 2, method: "tools/list" }, headers);
      expect(list.status).toBe(200);
      expect(list.headers.get("content-type")).toBe("application/json");
      const listResult = (await list.json()).result;
      expect(listResult.tools.map((tool: { name: string }) => tool.name)).toEqual(["web_search", "fetch"]);
      const call = await rpc(
        port,
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "web_search", arguments: { query: "coffee" } },
        },
        headers,
      );
      expect(call.status).toBe(200);
      expect(call.headers.get("content-type")).toBe("application/json");
      const callResult = (await call.json()).result;
      expect(callResult.structuredContent.result_count).toBe(1);
      for (const result of [listResult, callResult]) {
        expect(JSON.stringify(result)).not.toMatch(/"(?:ttlMs|cacheScope)"\s*:/);
      }
    },
  );

  test("returns 400 for a malformed request target", async () => {
    const port = await listen();
    const socket = connect(port, "127.0.0.1");
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    socket.write("GET //[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    const raw = await new Promise<string>((resolve) => {
      let data = "";
      socket.on("data", (chunk) => {
        data += chunk.toString();
      });
      socket.on("close", () => resolve(data));
    });
    expect(raw.startsWith("HTTP/1.1 400")).toBe(true);
  });

  test("logs rejected /mcp requests too", async () => {
    const port = await listen();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await rpc(port, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { origin: "http://evil.example" });
    await fetch(`http://127.0.0.1:${port}/mcp`);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const lines = spy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("Request unknown:"));
    expect(lines.filter((l) => / status=403$/.test(l))).toHaveLength(1);
    expect(lines.filter((l) => / status=405$/.test(l))).toHaveLength(1);
  });

  test("serves /health as JSON", async () => {
    const port = await listen();
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "cubicj-mcp-search", version: "0.2.0" });
  });

  test("rejects any request with an Origin header", async () => {
    const port = await listen();
    const response = await rpc(
      port,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { origin: "http://evil.example" },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    const empty = await rpc(port, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { origin: "" });
    expect(empty.status).toBe(403);
    const health = await fetch(`http://127.0.0.1:${port}/health`, { headers: { origin: "http://evil.example" } });
    expect(health.status).toBe(403);
  });

  test("returns 404 for unknown paths and 405 for non-POST on /mcp", async () => {
    const port = await listen();
    expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);
    const get = await fetch(`http://127.0.0.1:${port}/mcp`);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
  });

  test("returns JSON-RPC parse error for invalid JSON and 413 for oversized bodies", async () => {
    const port = await listen();
    const bad = await rpc(port, "{not json");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });

    const huge = await rpc(
      port,
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { pad: "x".repeat(1024 * 1024) } }),
    );
    expect(huge.status).toBe(413);
    expect((await huge.json()).error.code).toBe(-32600);
  });

  test("answers initialize and tools/list statelessly and calls tools", async () => {
    const braveClient: BraveClient = { llmContext: vi.fn(async () => raw) };
    const port = await listen({ braveClient });

    const init = await rpc(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    expect(init.status).toBe(200);
    expect((await init.json()).result.instructions).toBe(SERVER_INSTRUCTIONS);

    const list = await rpc(port, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect((await list.json()).result.tools.map((t: { name: string }) => t.name)).toEqual(["web_search", "fetch"]);

    const call = await rpc(port, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "web_search", arguments: { query: "coffee" } },
    });
    const body = await call.json();
    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent.result_count).toBe(1);
  });

  test("logs one line per /mcp request with the tool outcome", async () => {
    const braveClient: BraveClient = { llmContext: vi.fn(async () => raw) };
    const port = await listen({ braveClient });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await rpc(port, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "web_search",
        arguments: { query: "coffee", count: 20, max_tokens: 16384, freshness: "pw", country: "KR" },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const lines = spy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("Request tools/call web_search"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^Request tools\/call web_search q="coffee" count=20 max_tokens=16384 freshness="pw" country="KR": \d+ms status=200 era=2025 client="node" results=1 snippets=1 chars=5$/,
    );
    expect(lines[0]).not.toContain("First");
  });

  test("logs one line with the tool failure reason", async () => {
    const port = await listen();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await rpc(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "web_search", arguments: { query: "coffee" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Request tools\/call web_search q="coffee": \d+ms status=200 era=2025 client="node" tool_error reason="web_search failed: BRAVE_API_KEY is not configured"$/,
      ),
    );
  });

  test("logs rejected when input validation stops the call before the handler", async () => {
    const braveClient: BraveClient = { llmContext: vi.fn(async () => raw) };
    const port = await listen({ braveClient });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await rpc(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "web_search", arguments: { query: "coffee", country: "XX" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(braveClient.llmContext).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Request tools\/call web_search q="coffee" country="XX": \d+ms status=200 era=2025 client="node" rejected$/,
      ),
    );
  });

  test("logs fetch arguments and outcome without the response body", async () => {
    vi.spyOn(registry, "selectExtractor").mockReturnValue({
      name: "defuddle",
      matches: () => true,
      extract: vi.fn(async () => ({
        title: "Private title",
        markdown: "Private response body",
        metadata: { status: 200 },
        extractor: "defuddle",
      })),
    });
    const port = await listen();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await rpc(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "fetch", arguments: { url: "https://x.example", start_index: 8, max_length: 8, raw: false } },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(spy).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(
        /^Request tools\/call fetch url="https:\/\/x\.example" start_index=8 max_length=8 raw=false: \d+ms status=200 era=2025 client="node" extractor=defuddle http=200 chars=8$/,
      ),
    );
  });

  test.each([
    { status: 404, markdown: "Not found", outcome: "http=404 chars=9" },
    { status: 200, markdown: NO_CONTENT_NOTICE, outcome: `http=200 chars=${NO_CONTENT_NOTICE.length} notice` },
  ])("logs the upstream fetch outcome: $outcome", async ({ status, markdown, outcome }) => {
    vi.spyOn(registry, "selectExtractor").mockReturnValue({
      name: "defuddle",
      matches: () => true,
      extract: vi.fn(async () => ({ title: "Page", markdown, metadata: { status }, extractor: "defuddle" })),
    });
    const port = await listen();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await rpc(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "fetch", arguments: { url: "https://x.example" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(spy).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(
        new RegExp(
          `^Request tools/call fetch url="https://x\\.example": \\d+ms status=200 era=2025 client="node" extractor=defuddle ${outcome}$`,
        ),
      ),
    );
  });
});
