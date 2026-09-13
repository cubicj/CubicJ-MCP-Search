import type { Server } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { BraveClient } from "../src/brave/client.js";
import { createHttpServer, describeRequest } from "../src/http.js";
import { SERVER_INSTRUCTIONS, SERVER_VERSION } from "../src/server.js";

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
});

describe("createHttpServer", () => {
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
    expect(await response.json()).toEqual({ status: "ok", service: "cubicj-mcp-search", version: SERVER_VERSION });
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
      params: { name: "web_search", arguments: { query: "coffee" } },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const lines = spy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("Request tools/call web_search"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Request tools\/call web_search q="coffee": \d+ms status=200 results=1$/);
  });
});
