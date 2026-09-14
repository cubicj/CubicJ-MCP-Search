import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { RequestId } from "@modelcontextprotocol/sdk/types.js";
import { clip, printable } from "./log-text.js";
import { createMcpServer, SERVER_NAME, SERVER_VERSION, type ServerDeps } from "./server.js";

const MAX_BODY_BYTES = 1024 * 1024;

class PayloadTooLargeError extends Error {
  constructor() {
    super(`Request body exceeds ${MAX_BODY_BYTES} bytes`);
    this.name = "PayloadTooLargeError";
  }
}

export function describeRequest(message: unknown): string {
  const messages: unknown[] = Array.isArray(message) ? message : [message];
  return messages
    .map((entry) => {
      if (!entry || typeof entry !== "object" || !("method" in entry) || typeof entry.method !== "string")
        return "unknown";
      const method = printable(entry.method);
      if (entry.method !== "tools/call" || !("params" in entry)) return method;
      const params = entry.params;
      if (!params || typeof params !== "object" || !("name" in params) || typeof params.name !== "string")
        return method;

      const parts = [`tools/call ${printable(params.name)}`];
      const args =
        "arguments" in params && params.arguments && typeof params.arguments === "object" ? params.arguments : {};
      if ("query" in args && typeof args.query === "string")
        parts.push(`q=${JSON.stringify(clip(printable(args.query)))}`);
      if ("url" in args && typeof args.url === "string") parts.push(`url=${JSON.stringify(clip(printable(args.url)))}`);
      for (const [key, value] of Object.entries(args)) {
        if (key === "query" || key === "url") continue;
        if (typeof value === "string") parts.push(`${printable(key)}=${JSON.stringify(clip(printable(value)))}`);
        else if (typeof value === "number" || typeof value === "boolean") parts.push(`${printable(key)}=${value}`);
      }
      return parts.join(" ");
    })
    .join(",");
}

interface RequestLog {
  label: string;
  outcomes: () => string[];
}

function attachRequestLog(response: ServerResponse): RequestLog {
  const started = Date.now();
  const log: RequestLog = { label: "unknown", outcomes: () => [] };
  response.on("close", () => {
    const ms = Date.now() - started;
    const status = response.writableFinished
      ? `status=${response.statusCode}`
      : `aborted status=${response.statusCode}`;
    const outcomes = log.outcomes();
    const suffix = outcomes.length > 0 ? ` ${outcomes.join(",")}` : "";
    console.error(`Request ${log.label}: ${ms}ms ${status}${suffix}`);
  });
  return log;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > MAX_BODY_BYTES) throw new PayloadTooLargeError();
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? (JSON.parse(body) as unknown) : undefined;
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

const rpcError = (code: number, message: string) => ({ jsonrpc: "2.0", error: { code, message }, id: null });

function collectRequestIds(body: unknown): RequestId[] {
  const messages: unknown[] = Array.isArray(body) ? body : [body];
  const ids: RequestId[] = [];
  for (const entry of messages) {
    if (
      entry &&
      typeof entry === "object" &&
      "method" in entry &&
      entry.method === "tools/call" &&
      "id" in entry &&
      (typeof entry.id === "string" || typeof entry.id === "number")
    ) {
      ids.push(entry.id);
    }
  }
  return ids;
}

async function handleMcpRequest(deps: ServerDeps, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const log = attachRequestLog(response);

  if (request.headers.origin !== undefined) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, rpcError(-32000, "Method not allowed."), { allow: "POST" });
    return;
  }

  const outcomes = new Map<RequestId, string>();
  const server = createMcpServer({ ...deps, observer: (id, outcome) => outcomes.set(id, outcome) });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });

  try {
    const body = await readBody(request);
    const requestIds = collectRequestIds(body);
    log.label = describeRequest(body);
    log.outcomes = () => requestIds.map((id) => outcomes.get(id) ?? "rejected");
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  } catch (error) {
    if (!response.headersSent) {
      if (error instanceof PayloadTooLargeError) sendJson(response, 413, rpcError(-32600, error.message));
      else if (error instanceof SyntaxError) sendJson(response, 400, rpcError(-32700, "Parse error"));
      else sendJson(response, 500, rpcError(-32603, error instanceof Error ? error.message : "Internal server error"));
    }
  } finally {
    await transport.close();
    await server.close();
  }
}

function pathnameOf(request: IncomingMessage): string | undefined {
  try {
    return new URL(request.url ?? "/", "http://localhost").pathname;
  } catch {
    return undefined;
  }
}

export function createHttpServer(deps: ServerDeps = {}): Server {
  return createServer((request, response) => {
    const pathname = pathnameOf(request);

    if (pathname === undefined) {
      sendJson(response, 400, { error: "Bad request" });
      return;
    }

    if (pathname === "/mcp") {
      void handleMcpRequest(deps, request, response);
      return;
    }

    if (request.headers.origin !== undefined) {
      sendJson(response, 403, { error: "Forbidden" });
      return;
    }

    if (pathname === "/health") {
      sendJson(response, 200, { status: "ok", service: SERVER_NAME, version: SERVER_VERSION });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  });
}

export function startHttpServer(port: number, deps: ServerDeps = {}): Server {
  const server = createHttpServer(deps);
  server.once("error", (error: Error) => {
    console.error(`Failed to start HTTP server: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "0.0.0.0", () => {
    console.error(`${SERVER_NAME} ${SERVER_VERSION} listening on http://0.0.0.0:${port}/mcp`);
  });
  return server;
}
