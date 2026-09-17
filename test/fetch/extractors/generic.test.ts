import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { afterAll, beforeAll, test } from "vitest";
import { genericExtractor, NO_CONTENT_NOTICE } from "../../../src/fetch/extractors/generic.js";

let baseUrl: string;
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/data/result.json") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end('{"message":"unchanged"}\n');
      return;
    }

    if (request.url === "/notes/readme.txt") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("plain text\nunchanged");
      return;
    }

    if (request.url === "/document.pdf") {
      response.writeHead(200, { "Content-Type": "application/pdf" });
      response.end("not really a pdf");
      return;
    }

    if (request.url === "/files/sample.pdf") {
      response.writeHead(200, { "Content-Type": "application/pdf" });
      response.end(readFileSync(new URL("../fixtures/sample.pdf", import.meta.url)));
      return;
    }

    if (request.url === "/files/download") {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.end(readFileSync(new URL("../fixtures/sample.pdf", import.meta.url)));
      return;
    }

    if (request.url === "/files/blob.bin") {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.end(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      return;
    }

    if (request.url === "/article") {
      response.writeHead(206, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`
        <!doctype html>
        <html>
          <head><title>Generic Article</title></head>
          <body><main><h1>Generic Article</h1><p>Readable generic article body.</p></main></body>
        </html>
      `);
      return;
    }

    if (request.url === "/empty") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end("<!doctype html><html><head><title>Empty Page</title></head><body></body></html>");
      return;
    }

    if (request.url === "/challenge") {
      response.writeHead(403, { "Content-Type": "text/html" });
      response.end("<!doctype html><html><head><title>Just a moment...</title></head><body></body></html>");
      return;
    }

    if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/redirected/data.json" });
      response.end();
      return;
    }

    if (request.url === "/redirected/data.json") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("{}");
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("not found");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test("genericExtractor returns JSON unchanged as plain text", async () => {
  const result = await genericExtractor.extract(`${baseUrl}/data/result.json`);
  assert.equal(result.extractor, "plain");
  assert.equal(result.title, "result.json");
  assert.equal(result.markdown, '{"message":"unchanged"}\n');
  assert.deepEqual(result.metadata, { status: 200, content_type: "application/json" });
});

test("genericExtractor returns text/plain unchanged", async () => {
  const result = await genericExtractor.extract(`${baseUrl}/notes/readme.txt`);
  assert.equal(result.extractor, "plain");
  assert.equal(result.title, "readme.txt");
  assert.equal(result.markdown, "plain text\nunchanged");
});

test("genericExtractor rejects binary content types", async () => {
  await assert.rejects(genericExtractor.extract(`${baseUrl}/document.pdf`), {
    message: /^PDF extraction failed: /,
  });
});

test("application/pdf dispatches to the pdf handler", async () => {
  const result = await genericExtractor.extract(`${baseUrl}/files/sample.pdf`);
  assert.equal(result.extractor, "pdf");
  assert.equal(result.metadata.page_count, 2);
});

test("octet-stream with PDF magic dispatches to the pdf handler", async () => {
  const result = await genericExtractor.extract(`${baseUrl}/files/download`);
  assert.equal(result.extractor, "pdf");
});

test("octet-stream without PDF magic is rejected", async () => {
  await assert.rejects(genericExtractor.extract(`${baseUrl}/files/blob.bin`), /Unsupported content type/);
});

test("genericExtractor extracts HTML with HTTP metadata", async () => {
  const result = await genericExtractor.extract(`${baseUrl}/article`);
  assert.equal(result.extractor, "defuddle");
  assert.equal(result.title, "Generic Article");
  assert.match(result.markdown, /Readable generic article body\./);
  assert.equal(result.metadata.status, 206);
  assert.equal(result.metadata.content_type, "text/html");
});

test("bot-protection challenge pages are errors", async () => {
  await assert.rejects(
    genericExtractor.extract(`${baseUrl}/challenge`),
    /Blocked by bot protection \(status 403, title "Just a moment\.\.\."\)/,
  );
});

test("empty pages direct callers to another URL instead of a raw retry", async () => {
  const result = await genericExtractor.extract(`${baseUrl}/empty`);
  assert.equal(result.extractor, "defuddle");
  assert.equal(result.title, "Empty Page");
  assert.equal(result.markdown, NO_CONTENT_NOTICE);
  assert.match(result.markdown, /JavaScript rendering or a login/);
  assert.match(result.markdown, /raw=true returns the same JavaScript shell; try a different URL\./);
  assert.match(result.markdown, /^\[[^\r\n]+\]$/);
  assert.doesNotMatch(result.markdown, /Retry with raw/);
});

test("genericExtractor includes final_url only after a redirect", async () => {
  const direct = await genericExtractor.extract(`${baseUrl}/data/result.json`);
  const redirected = await genericExtractor.extract(`${baseUrl}/redirect`);
  assert.equal(direct.metadata.final_url, undefined);
  assert.equal(redirected.metadata.final_url, `${baseUrl}/redirected/data.json`);
  assert.equal(redirected.title, "data.json");
});
