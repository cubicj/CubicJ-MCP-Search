import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test, vi } from "vitest";
import { namuWikiExtractor } from "../../../../src/fetch/extractors/namu-wiki/extractor.js";
import { type FetchedDocument, fetchDocument } from "../../../../src/fetch/fetch.js";

vi.mock("../../../../src/fetch/fetch.js", () => ({
  fetchDocument: vi.fn(),
}));

const mockedFetchDocument = vi.mocked(fetchDocument);
const fixtureUrl = new URL("../../fixtures/namu-wiki/page.html", import.meta.url);

function fetchedDocument(text: string, finalUrl: string): FetchedDocument {
  return {
    requestedUrl: finalUrl,
    finalUrl,
    status: 200,
    statusText: "OK",
    contentType: "text/html; charset=utf-8",
    bytes: new TextEncoder().encode(text),
    text,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

test("namuWikiExtractor extracts the article body without surrounding toolbar residue", async () => {
  const html = await readFile(fixtureUrl, "utf8");
  const url = "https://namu.wiki/w/%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD";
  mockedFetchDocument.mockResolvedValue(fetchedDocument(html, url));

  const result = await namuWikiExtractor.extract(url);

  assert.equal(mockedFetchDocument.mock.calls[0]?.[0], url);
  assert.equal(result.title, "대한민국");
  assert.equal(result.extractor, "namu-wiki");
  assert.match(result.markdown, /대한민국은 동아시아의 한반도 남부/);
  assert.match(result.markdown, /국가 상징에는 국기, 국가, 국화/);
  assert.match(result.markdown, /동쪽은 동해, 서쪽은 서해/);
  assert.doesNotMatch(result.markdown, /최근 변경|RandomPage|도구/);
  assert.equal(result.metadata.domain, "namu.wiki");
  assert.equal(result.metadata.site, "나무위키");
  assert.equal(result.metadata.status, 200);
  assert.equal(result.metadata.content_type, "text/html; charset=utf-8");
});
