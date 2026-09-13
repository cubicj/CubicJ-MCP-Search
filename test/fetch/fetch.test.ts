import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { afterAll, beforeAll, test } from "vitest";
import { fetchDocument, resolveRequestHeaders } from "../../src/fetch/fetch.js";

const koreanBytes = Buffer.from([199, 209, 177, 219, 32, 197, 215, 189, 186, 198, 174]);
const metaPrefix = Buffer.from('<!doctype html><meta charset="euc-kr"><p>');
const metaSuffix = Buffer.from("</p>");

let baseUrl: string;
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/header-euc") {
      response.writeHead(200, { "Content-Type": "text/html; charset=euc-kr" });
      response.end(koreanBytes);
      return;
    }

    if (request.url === "/ms949") {
      response.writeHead(200, { "Content-Type": "text/html;charset=MS949" });
      response.end(koreanBytes);
      return;
    }

    if (request.url === "/meta-euc") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(Buffer.concat([metaPrefix, koreanBytes, metaSuffix]));
      return;
    }

    if (request.url === "/utf8") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("기본 UTF-8");
      return;
    }

    if (request.url === "/unsupported-charset") {
      response.writeHead(200, { "Content-Type": "text/plain; charset=not-a-real-charset" });
      response.end("UTF-8 fallback");
      return;
    }

    if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/final" });
      response.end();
      return;
    }

    if (request.url === "/final") {
      response.writeHead(207, { "Content-Type": "text/plain" });
      response.end("redirected");
      return;
    }

    if (request.url === "/headers") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          userAgent: request.headers["user-agent"],
          accept: request.headers.accept,
          acceptLanguage: request.headers["accept-language"],
        }),
      );
      return;
    }

    if (request.url === "/echo-user-agent") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end(request.headers["user-agent"] ?? "");
      return;
    }

    if (request.url === "/content-type") {
      response.writeHead(200, { "Content-Type": "Application/JSON; Charset=UTF-8" });
      response.end("{}");
      return;
    }

    response.writeHead(404);
    response.end();
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

test("fetchDocument decodes an EUC-KR body from the Content-Type charset", async () => {
  const document = await fetchDocument(`${baseUrl}/header-euc`);
  assert.equal(document.text, "한글 테스트");
});

test("fetchDocument sniffs an EUC-KR HTML meta charset", async () => {
  const document = await fetchDocument(`${baseUrl}/meta-euc`);
  assert.equal(document.text, '<!doctype html><meta charset="euc-kr"><p>한글 테스트</p>');
});

test("fetchDocument defaults to UTF-8 when no charset is available", async () => {
  const document = await fetchDocument(`${baseUrl}/utf8`);
  assert.equal(document.text, "기본 UTF-8");
});

test("exposes raw bytes", async () => {
  const document = await fetchDocument(`${baseUrl}/utf8`);
  assert.ok(document.bytes instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(document.bytes), "기본 UTF-8");
});

test("fetchDocument falls back to UTF-8 for an unsupported charset", async () => {
  const document = await fetchDocument(`${baseUrl}/unsupported-charset`);
  assert.equal(document.text, "UTF-8 fallback");
});

test("decodes MS949 as EUC-KR", async () => {
  const document = await fetchDocument(`${baseUrl}/ms949`);
  assert.equal(document.text, "한글 테스트");
});

test("network errors include the cause", async () => {
  await assert.rejects(fetchDocument("http://127.0.0.1:1/"), (error: Error) => {
    assert.match(error.message, /^fetch failed: /);
    assert.match(error.message, /ECONNREFUSED|bad port/);
    return true;
  });
  await assert.rejects(fetchDocument("https://nonexistent.invalid/"), /fetch failed: ENOTFOUND/);
});

test("fetchDocument reports the final redirect URL and status", async () => {
  const requestedUrl = `${baseUrl}/redirect`;
  const document = await fetchDocument(requestedUrl);
  assert.equal(document.requestedUrl, requestedUrl);
  assert.equal(document.finalUrl, `${baseUrl}/final`);
  assert.equal(document.status, 207);
});

test("fetchDocument exposes the HTTP status text", async () => {
  const document = await fetchDocument(`${baseUrl}/missing`);
  assert.equal(document.status, 404);
  assert.equal(document.statusText, "Not Found");
});

test("fetchDocument sends browser request headers", async () => {
  const document = await fetchDocument(`${baseUrl}/headers`);
  const headers = JSON.parse(document.text);
  assert.match(headers.userAgent, /^Mozilla\/5\.0 .* Chrome\/151\.0\.0\.0 Safari\/537\.36$/);
  assert.equal(headers.accept, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
  assert.equal(headers.acceptLanguage, "ko,en;q=0.9");
});

test("fetchDocument lets caller headers override defaults", async () => {
  const document = await fetchDocument(`${baseUrl}/headers`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  const headers = JSON.parse(document.text);
  assert.equal(headers.accept, "application/vnd.github+json");
});

test("brunch.co.kr requests omit the User-Agent header", () => {
  assert.equal(resolveRequestHeaders("https://brunch.co.kr/@brunch/1").get("user-agent"), null);
  assert.equal(resolveRequestHeaders("https://m.brunch.co.kr/@brunch/1").get("user-agent"), null);
  assert.match(resolveRequestHeaders("https://example.com/").get("user-agent") ?? "", /Chrome/);
});

test("resolved headers control the wire-level User-Agent", async () => {
  const defaultDocument = await fetchDocument(`${baseUrl}/echo-user-agent`);
  assert.match(defaultDocument.text, /Chrome\/151/);

  const headers = resolveRequestHeaders("https://brunch.co.kr/@brunch/1");
  const response = await fetch(`${baseUrl}/echo-user-agent`, { headers });
  const body = await response.text();
  assert.doesNotMatch(body, /Chrome\//);
});

test("explicit headers override host defaults", () => {
  const headers = resolveRequestHeaders("https://brunch.co.kr/x", { "User-Agent": "custom" });
  assert.equal(headers.get("user-agent"), "custom");
});

test("fetchDocument normalizes Content-Type to a lowercase media type", async () => {
  const document = await fetchDocument(`${baseUrl}/content-type`);
  assert.equal(document.contentType, "application/json");
});
