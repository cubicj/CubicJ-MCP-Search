import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test, vi } from "vitest";
import { NO_CONTENT_NOTICE } from "../../../../src/fetch/extractors/generic.js";
import { naverBlogExtractor, parseNaverBlogUrl } from "../../../../src/fetch/extractors/naver-blog/extractor.js";
import { type FetchedDocument, fetchDocument } from "../../../../src/fetch/fetch.js";

vi.mock("../../../../src/fetch/fetch.js", () => ({
  fetchDocument: vi.fn(),
}));

const mockedFetchDocument = vi.mocked(fetchDocument);
const fixtureUrl = new URL("../../fixtures/naver-blog/postview.html", import.meta.url);

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

test("parseNaverBlogUrl recognizes post view and short post URLs", () => {
  const cases = [
    ["https://blog.naver.com/PostView.naver?blogId=coffee&logNo=12345", { blogId: "coffee", logNo: "12345" }],
    ["http://m.blog.naver.com/PostView.nhn?blogId=beans&logNo=0007", { blogId: "beans", logNo: "0007" }],
    ["https://blog.naver.com/coffee/12345", { blogId: "coffee", logNo: "12345" }],
    ["ftp://m.blog.naver.com/beans/987", { blogId: "beans", logNo: "987" }],
  ] as const;

  for (const [url, expected] of cases) {
    assert.deepEqual(parseNaverBlogUrl(new URL(url)), expected, url);
  }
});

test("parseNaverBlogUrl rejects non-post Naver Blog URLs", () => {
  const urls = [
    "https://blog.naver.com/PostList.naver?blogId=coffee",
    "https://blog.naver.com/coffee",
    "https://blog.naver.com/coffee/not-digits",
    "https://blog.naver.com/PostView.naver?blogId=coffee&logNo=12x",
    "https://blog.naver.com/PostView.naver?blogId=coffee",
    "https://blog.naver.com/coffee%2Fbeans/123",
    "https://example.com/coffee/123",
  ];

  for (const url of urls) {
    assert.equal(parseNaverBlogUrl(new URL(url)), null, url);
  }
});

test("naverBlogExtractor extracts SmartEditor body and metadata without sibling navigation", async () => {
  const html = await readFile(fixtureUrl, "utf8");
  const calledUrl = "https://blog.naver.com/sample-blog/123456";
  const postViewUrl = "https://blog.naver.com/PostView.naver?blogId=sample-blog&logNo=123456";
  mockedFetchDocument.mockResolvedValue(fetchedDocument(html, postViewUrl));

  const result = await naverBlogExtractor.extract(calledUrl);

  assert.equal(mockedFetchDocument.mock.calls[0]?.[0], postViewUrl);
  assert.equal(result.title, "Synthetic Naver Post");
  assert.equal(result.metadata.author, "Naver Author");
  assert.equal(result.metadata.published, "2023. 5. 28. 17:29");
  assert.equal(result.metadata.description, "Synthetic post description");
  assert.equal(result.metadata.domain, "blog.naver.com");
  assert.ok((result.metadata.word_count ?? 0) > 0);
  assert.equal(result.metadata.final_url, postViewUrl);
  assert.equal(result.metadata.status, 200);
  assert.equal(result.metadata.content_type, "text/html");
  assert.equal(result.extractor, "naver-blog");
  assert.match(result.markdown, /Body Heading/);
  assert.match(result.markdown, /First paragraph from the Naver Blog post\./);
  assert.doesNotMatch(result.markdown, /공유하기|메뉴 바로가기/);
});

test("naverBlogExtractor uses the legacy postViewArea container", async () => {
  const calledUrl = "https://m.blog.naver.com/legacy/42";
  const postViewUrl = "https://blog.naver.com/PostView.naver?blogId=legacy&logNo=42";
  const html = `<!doctype html><html><head><title>Legacy Post : 네이버 블로그</title></head><body><a href="#">공유하기</a><div id="postViewArea"><p>Legacy body content.</p></div></body></html>`;
  mockedFetchDocument.mockResolvedValue(fetchedDocument(html, postViewUrl));

  const result = await naverBlogExtractor.extract(calledUrl);

  assert.equal(result.title, "Legacy Post");
  assert.match(result.markdown, /Legacy body content\./);
  assert.doesNotMatch(result.markdown, /공유하기/);
});

test("naverBlogExtractor keeps Untitled when only Defuddle derives a title", async () => {
  const calledUrl = "https://blog.naver.com/untitled/43";
  const postViewUrl = "https://blog.naver.com/PostView.naver?blogId=untitled&logNo=43";
  const html = `<!doctype html><html><body><div class="se-main-container"><article><h1>Defuddle Body Title</h1><p>Readable Naver Blog body content.</p></article></div></body></html>`;
  mockedFetchDocument.mockResolvedValue(fetchedDocument(html, postViewUrl));

  const result = await naverBlogExtractor.extract(calledUrl);

  assert.equal(result.title, "Untitled");
});

test("naverBlogExtractor returns the shared no-content notice for an empty page", async () => {
  const calledUrl = "https://blog.naver.com/empty/9";
  const postViewUrl = "https://blog.naver.com/PostView.naver?blogId=empty&logNo=9";
  const html = "<!doctype html><html><head><title>Empty Post : 네이버 블로그</title></head><body></body></html>";
  mockedFetchDocument.mockResolvedValue(fetchedDocument(html, postViewUrl));

  const result = await naverBlogExtractor.extract(calledUrl);

  assert.equal(result.title, "Empty Post");
  assert.equal(result.markdown, NO_CONTENT_NOTICE);
});
