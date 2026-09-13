import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { test } from "vitest";

async function getFreePort() {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

async function waitForHealth(port) {
  const deadline = Date.now() + 5000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw lastError;
}

async function postRpc(port, message) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(message),
  });

  const text = await response.text();
  assert.ok(response.ok, text);

  if (!text) {
    return undefined;
  }

  return JSON.parse(text);
}

async function startHtmlServer(html) {
  const server = createHttpServer((req, res) => {
    if (req.url === "/article") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.url === "/challenge") {
      res.writeHead(403, { "content-type": "text/html" });
      res.end("<!doctype html><html><head><title>Just a moment...</title></head><body></body></html>");
      return;
    }

    if (req.url === "/files/sample.pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end(readFileSync(new URL("fetch/fixtures/sample.pdf", import.meta.url)));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  return {
    url: `http://127.0.0.1:${address.port}/article`,
    challengeUrl: `http://127.0.0.1:${address.port}/challenge`,
    pdfUrl: `http://127.0.0.1:${address.port}/files/sample.pdf`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function stopProcess(child) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill();
  await once(child, "close");
}

test("HTTP transport exposes a health endpoint", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["dist/index.js", "--transport", "http", "--port", String(port)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const response = await waitForHealth(port);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", service: "cubicj-mcp-search", version: "0.1.0" });

    const headResponse = await fetch(`http://127.0.0.1:${port}/health`, { method: "HEAD" });
    assert.equal(headResponse.status, 200);
  } finally {
    await stopProcess(child);
  }
});

test("HTTP transport rejects requests carrying an Origin header", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["dist/index.js", "--transport", "http", "--port", String(port)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForHealth(port);

    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        origin: "http://attacker.example",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Forbidden" });

    const clean = await postRpc(port, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    assert.ok(clean.result.tools.some((tool) => tool.name === "fetch"));
  } finally {
    await stopProcess(child);
  }
});

test("HTTP transport fails cleanly when the port is taken", async () => {
  const port = await getFreePort();
  const first = spawn(process.execPath, ["dist/index.js", "--transport", "http", "--port", String(port)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForHealth(port);

    const second = spawn(process.execPath, ["dist/index.js", "--transport", "http", "--port", String(port)], {
      cwd: new URL("..", import.meta.url),
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    second.stderr.setEncoding("utf8");
    second.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const [code] = await once(second, "close");

    assert.equal(code, 1);
    assert.match(stderr, /Failed to start HTTP server/);
    assert.doesNotMatch(stderr, /at Server/);
  } finally {
    await stopProcess(first);
  }
});

test("HTTP transport rejects invalid port values", async () => {
  const child = spawn(process.execPath, ["dist/index.js", "--transport", "http", "--port", "abc"], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const [code] = await once(child, "close");

  assert.notEqual(code, 0);
  assert.match(stderr, /Invalid port/);
});

test("HTTP transport serves concurrent stateless requests", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["dist/index.js", "--transport", "http", "--port", String(port)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const article = await startHtmlServer(`
    <!doctype html>
    <html>
      <head><title>Concurrent Fixture</title></head>
      <body><main><p>Concurrent fixture body.</p></main></body>
    </html>
  `);

  try {
    await waitForHealth(port);

    const calls = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        postRpc(port, {
          jsonrpc: "2.0",
          id: 100 + i,
          method: "tools/call",
          params: {
            name: "fetch",
            arguments: {
              url: article.url,
              raw: true,
              max_length: 80,
            },
          },
        }),
      ),
    );

    for (const call of calls) {
      assert.ok(call.result, JSON.stringify(call));
      assert.notEqual(call.result.isError, true);
    }
  } finally {
    await article.close();
    await stopProcess(child);
  }
});

test("fetch tool reports unreachable URLs as MCP errors", async () => {
  const port = await getFreePort();
  let deadPort = await getFreePort();
  while (deadPort === port) {
    deadPort = await getFreePort();
  }

  const child = spawn(process.execPath, ["dist/index.js", "--transport", "http", "--port", String(port)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForHealth(port);

    const call = await postRpc(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "fetch",
        arguments: {
          url: `http://127.0.0.1:${deadPort}/`,
        },
      },
    });

    assert.equal(call.result.isError, true);
    assert.match(call.result.content[0].text, /^Error fetching http:\/\/127\.0\.0\.1:/);
  } finally {
    await stopProcess(child);
  }
});

test("fetch tool reports bot-protection challenge pages as MCP errors", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["dist/index.js", "--transport", "http", "--port", String(port)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const article = await startHtmlServer("");

  try {
    await waitForHealth(port);

    const call = await postRpc(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "fetch",
        arguments: {
          url: article.challengeUrl,
        },
      },
    });

    assert.equal(call.result.isError, true);
    assert.match(call.result.content[0].text, /Blocked by bot protection/);
  } finally {
    await article.close();
    await stopProcess(child);
  }
});

test("raw mode slices content by start_index and max_length", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["dist/index.js", "--transport", "http", "--port", String(port)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const html = "0123456789abcdefghijklmnopqrstuvwxyz";
  const article = await startHtmlServer(html);

  try {
    await waitForHealth(port);

    const call = await postRpc(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "fetch",
        arguments: {
          url: article.url,
          raw: true,
          start_index: 10,
          max_length: 5,
        },
      },
    });

    const result = call.result;
    assert.notEqual(result.isError, true);
    assert.equal(
      result.content[0].text,
      "abcde\n\n[Truncated. Total length: 36 characters. Continue with start_index=15.]",
    );
    assert.equal(result.structuredContent.content, "abcde");
    assert.equal(result.structuredContent.start_index, 10);
    assert.equal(result.structuredContent.max_length, 5);
    assert.equal(result.structuredContent.total_length, 36);
  } finally {
    await article.close();
    await stopProcess(child);
  }
});

test("raw mode keeps surrogate pairs intact across page boundaries", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["dist/index.js", "--transport", "http", "--port", String(port)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const html = "aaaa\u{1F600}bbbb";
  const article = await startHtmlServer(html);

  try {
    await waitForHealth(port);

    const callPage = async (startIndex) => {
      const call = await postRpc(port, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "fetch",
          arguments: {
            url: article.url,
            raw: true,
            start_index: startIndex,
            max_length: 5,
          },
        },
      });
      assert.notEqual(call.result.isError, true);
      return call.result.structuredContent.content;
    };

    const firstPage = await callPage(0);
    const secondPage = await callPage(5);

    assert.equal(firstPage, "aaaa\u{1F600}");
    assert.equal(secondPage, "bbbb");
    assert.equal(firstPage + secondPage, html);
  } finally {
    await article.close();
    await stopProcess(child);
  }
});

test("fetch tool returns PDF extraction metadata", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["dist/index.js", "--transport", "http", "--port", String(port)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const article = await startHtmlServer("");

  try {
    await waitForHealth(port);

    const call = await postRpc(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "fetch",
        arguments: {
          url: article.pdfUrl,
        },
      },
    });

    const result = call.result;
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.extractor, "pdf");
    assert.equal(result.structuredContent.metadata.page_count, 2);
    assert.match(result.content[0].text, /\*\*Pages\*\*: 2/);
  } finally {
    await article.close();
    await stopProcess(child);
  }
});

test("stdio transport answers initialize and tools/list", async () => {
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: new URL("..", import.meta.url),
    stdio: ["pipe", "pipe", "pipe"],
  });

  const responses = new Map();
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const newlineIdx = buffer.indexOf("\n");
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (!line.trim()) {
        continue;
      }
      const message = JSON.parse(line);
      if (message.id !== undefined) {
        responses.set(message.id, message);
      }
    }
  });

  async function waitForResponse(id) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (responses.has(id)) {
        return responses.get(id);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`No stdio response for id ${id}`);
  }

  try {
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "defuddle-fetch-mcp-test", version: "0.1.0" },
        },
      })}\n`,
    );

    const initialize = await waitForResponse(1);
    assert.equal(initialize.result.serverInfo.name, "cubicj-mcp-search");

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);

    const tools = await waitForResponse(2);
    assert.ok(tools.result.tools.some((tool) => tool.name === "fetch"));
  } finally {
    await stopProcess(child);
  }
});

test("HTTP transport exposes MCP metadata and structured fetch results", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["dist/index.js", "--transport", "http", "--port", String(port)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const article = await startHtmlServer(`
    <!doctype html>
    <html>
      <head>
        <title>Fixture Article</title>
        <meta name="author" content="Ada Example">
        <meta property="article:published_time" content="2026-08-20T09:30:00Z">
        <meta name="description" content="Fixture description">
        <meta property="og:site_name" content="Fixture Site">
      </head>
      <body>
        <main>
          <h1>Fixture Article</h1>
          <p>This local fixture proves Defuddle Fetch MCP returns readable content with document metadata.</p>
        </main>
      </body>
    </html>
  `);

  try {
    await waitForHealth(port);

    const initialize = await postRpc(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: {
          name: "defuddle-fetch-mcp-test",
          version: "0.1.0",
        },
      },
    });

    assert.equal(initialize.jsonrpc, "2.0");
    assert.equal(initialize.id, 1);
    assert.match(initialize.result.instructions, /^Web research connector with two read-only tools\./);
    assert.ok(Buffer.byteLength(initialize.result.instructions, "utf8") < 2048);

    await postRpc(port, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    const tools = await postRpc(port, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });

    const fetchTool = tools.result.tools.find((tool) => tool.name === "fetch");
    assert.ok(fetchTool);
    assert.equal(fetchTool.title, "Fetch URL");
    assert.equal(fetchTool.annotations.readOnlyHint, true);
    assert.equal(fetchTool.annotations.destructiveHint, false);
    assert.equal(fetchTool.annotations.idempotentHint, true);
    assert.equal(fetchTool.annotations.openWorldHint, true);
    assert.equal(fetchTool._meta["anthropic/maxResultSizeChars"], 200000);
    assert.match(fetchTool.description, /^Fetch one URL and return its readable content as markdown/);
    assert.ok(Buffer.byteLength(fetchTool.description, "utf8") < 2048);
    assert.equal(fetchTool.outputSchema.type, "object");
    assert.equal(fetchTool.inputSchema.properties.max_length.default, 50000);
    assert.equal(fetchTool.outputSchema.properties.total_length.type, "integer");
    assert.equal(fetchTool.outputSchema.properties.total_length.minimum, 0);
    assert.equal(fetchTool.outputSchema.properties.metadata.type, "object");
    assert.equal(fetchTool.outputSchema.properties.extractor.type, "string");
    assert.ok(!fetchTool.outputSchema.required.includes("extractor"));
    assert.deepEqual(Object.keys(fetchTool.outputSchema.properties.metadata.properties), [
      "author",
      "published",
      "description",
      "domain",
      "site",
      "word_count",
      "page_count",
      "views",
      "recommends",
      "comment_count",
      "status",
      "final_url",
      "content_type",
    ]);
    assert.ok(!fetchTool.outputSchema.required.includes("metadata"));
    assert.equal(fetchTool.outputSchema.properties.metadata.required, undefined);

    const call = await postRpc(port, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "fetch",
        arguments: {
          url: article.url,
          max_length: 2000,
        },
      },
    });

    const result = call.result;
    assert.notEqual(result.isError, true);
    assert.match(result.content[0].text, /# Fixture Article/);
    assert.ok(
      result.content[0].text.startsWith(
        `# Fixture Article\n\n**URL**: ${article.url}\n**Author**: Ada Example\n**Published**: 2026-08-20T09:30:00Z\n**Description**: Fixture description\n**Site**: Fixture Site\n**Domain**: 127.0.0.1\n**Word count**: 13\n**Status**: 200\n**Content type**: text/html\n\n`,
      ),
    );
    assert.match(
      result.content[0].text,
      /This local fixture proves Defuddle Fetch MCP returns readable content with document metadata/,
    );
    assert.equal(result.structuredContent.url, article.url);
    assert.equal(result.structuredContent.title, "Fixture Article");
    assert.equal(result.structuredContent.mode, "markdown");
    assert.equal(result.structuredContent.extractor, "defuddle");
    assert.equal(result.structuredContent.start_index, 0);
    assert.equal(result.structuredContent.max_length, 2000);
    assert.match(
      result.structuredContent.content,
      /This local fixture proves Defuddle Fetch MCP returns readable content with document metadata/,
    );
    assert.equal(result.structuredContent.total_length, result.structuredContent.content.length);
    assert.deepEqual(result.structuredContent.metadata, {
      author: "Ada Example",
      published: "2026-08-20T09:30:00Z",
      description: "Fixture description",
      domain: "127.0.0.1",
      site: "Fixture Site",
      word_count: 13,
      status: 200,
      content_type: "text/html",
    });

    const truncatedCall = await postRpc(port, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "fetch",
        arguments: {
          url: article.url,
          max_length: 10,
        },
      },
    });

    const truncatedResult = truncatedCall.result;
    assert.notEqual(truncatedResult.isError, true);
    assert.ok(truncatedResult.structuredContent.total_length > 10);
    assert.equal(
      truncatedResult.content[0].text,
      `# Fixture Article\n\n**URL**: ${article.url}\n**Author**: Ada Example\n**Published**: 2026-08-20T09:30:00Z\n**Description**: Fixture description\n**Site**: Fixture Site\n**Domain**: 127.0.0.1\n**Word count**: 13\n**Status**: 200\n**Content type**: text/html\n\n${truncatedResult.structuredContent.content}\n\n[Truncated. Total length: ${truncatedResult.structuredContent.total_length} characters. Continue with start_index=10.]`,
    );
    assert.doesNotMatch(truncatedResult.structuredContent.content, /\[Truncated\./);
    assert.deepEqual(truncatedResult.structuredContent.metadata, result.structuredContent.metadata);

    const rawCall = await postRpc(port, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "fetch",
        arguments: {
          url: article.url,
          raw: true,
          max_length: 80,
          start_index: 0,
        },
      },
    });

    const rawResult = rawCall.result;
    assert.notEqual(rawResult.isError, true);
    assert.match(rawResult.content[0].text, /<!doctype html>/);
    assert.equal(rawResult.structuredContent.url, article.url);
    assert.equal(rawResult.structuredContent.title, "Untitled");
    assert.equal(rawResult.structuredContent.mode, "raw");
    assert.equal(rawResult.structuredContent.extractor, undefined);
    assert.equal(rawResult.structuredContent.start_index, 0);
    assert.equal(rawResult.structuredContent.max_length, 80);
    assert.match(rawResult.structuredContent.content, /<!doctype html>/);
    assert.ok(rawResult.structuredContent.total_length > 80);
    assert.equal(rawResult.structuredContent.metadata, undefined);
    assert.equal(
      rawResult.content[0].text,
      `${rawResult.structuredContent.content}\n\n[Truncated. Total length: ${rawResult.structuredContent.total_length} characters. Continue with start_index=80.]`,
    );
  } finally {
    await article.close();
    await stopProcess(child);
  }
});

test("markdown mode omits unavailable document metadata fields", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["dist/index.js", "--transport", "http", "--port", String(port)], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const article = await startHtmlServer(`
    <!doctype html>
    <html>
      <head><title>Plain Fixture</title></head>
      <body><main><p>Plain fixture body without document metadata.</p></main></body>
    </html>
  `);

  try {
    await waitForHealth(port);

    const call = await postRpc(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "fetch",
        arguments: {
          url: article.url,
          max_length: 2000,
        },
      },
    });

    const result = call.result;
    assert.notEqual(result.isError, true);
    assert.deepEqual(result.structuredContent.metadata, {
      domain: "127.0.0.1",
      site: "127.0.0.1",
      word_count: 6,
      status: 200,
      content_type: "text/html",
    });
    assert.ok(!Object.hasOwn(result.structuredContent.metadata, "author"));
    assert.ok(!Object.hasOwn(result.structuredContent.metadata, "published"));
    assert.ok(!Object.hasOwn(result.structuredContent.metadata, "description"));
    assert.equal(
      result.content[0].text,
      `# Plain Fixture\n\n**URL**: ${article.url}\n**Site**: 127.0.0.1\n**Domain**: 127.0.0.1\n**Word count**: 6\n**Status**: 200\n**Content type**: text/html\n\nPlain fixture body without document metadata.`,
    );
  } finally {
    await article.close();
    await stopProcess(child);
  }
});

test("web_search reports a missing API key when the process has none", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["dist/index.js", "--transport", "http", "--port", String(port)], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, BRAVE_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForHealth(port);
    const call = await postRpc(port, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "web_search", arguments: { query: "coffee" } },
    });
    assert.equal(call.result.isError, true);
    assert.equal(call.result.content[0].text, "web_search failed: BRAVE_API_KEY is not configured");
  } finally {
    await stopProcess(child);
  }
});
