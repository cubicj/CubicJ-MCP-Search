import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test, vi } from "vitest";
import { clienExtractor } from "../../../../src/fetch/extractors/clien/extractor.js";
import { type FetchedDocument, fetchDocument } from "../../../../src/fetch/fetch.js";

vi.mock("../../../../src/fetch/fetch.js", () => ({
  fetchDocument: vi.fn(),
}));

const mockedFetchDocument = vi.mocked(fetchDocument);
const fixtureUrl = new URL("../../fixtures/clien/post.html", import.meta.url);

function fetchedDocument(text: string, finalUrl: string): FetchedDocument {
  return {
    requestedUrl: finalUrl,
    finalUrl,
    status: 200,
    statusText: "OK",
    contentType: "text/html",
    bytes: new TextEncoder().encode(text),
    text,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

test("clienExtractor extracts the scoped post body and comments", async () => {
  const html = await readFile(fixtureUrl, "utf8");
  const url = "https://www.clien.net/service/board/park/18977000";
  mockedFetchDocument.mockResolvedValue(fetchedDocument(html, url));

  const result = await clienExtractor.extract(url);

  assert.equal(mockedFetchDocument.mock.calls[0]?.[0], url);
  assert.equal(result.title, "퓰리처상급 김문수 유세 사진");
  assert.equal(result.extractor, "clien");
  assert.match(result.markdown, /김문순대 ㅋㅋㅋㅋㅋㅋ/);
  assert.match(result.markdown, /## Comments \(3\)/);
  assert.equal(result.metadata.author, "dramarama");
  assert.equal(result.metadata.comment_count, 3);
  assert.equal(result.metadata.domain, "clien.net");
  assert.equal(result.metadata.site, "클리앙");
  assert.ok((result.metadata.word_count ?? 0) > 0);
  assert.equal(result.metadata.status, 200);
  assert.equal(result.metadata.content_type, "text/html");
});
