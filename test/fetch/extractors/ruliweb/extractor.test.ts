import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test, vi } from "vitest";
import { ruliwebExtractor } from "../../../../src/fetch/extractors/ruliweb/extractor.js";
import { type FetchedDocument, fetchDocument } from "../../../../src/fetch/fetch.js";

vi.mock("../../../../src/fetch/fetch.js", () => ({
  fetchDocument: vi.fn(),
}));

const mockedFetchDocument = vi.mocked(fetchDocument);
const fixtureUrl = new URL("../../fixtures/ruliweb/post.html", import.meta.url);

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

test("ruliwebExtractor extracts the scoped post body and comments", async () => {
  const html = await readFile(fixtureUrl, "utf8");
  const url = "https://bbs.ruliweb.com/community/board/300143/read/70000000";
  mockedFetchDocument.mockResolvedValue(fetchedDocument(html, url));

  const result = await ruliwebExtractor.extract(url);

  assert.equal(mockedFetchDocument.mock.calls[0]?.[0], url);
  assert.equal(result.title, "스팀OS데탑버전 언제 출시하지");
  assert.equal(result.extractor, "ruliweb");
  assert.match(result.markdown, /프리릴리즈는 나왔지만 덜컥깔긴싫음/);
  assert.match(result.markdown, /## Comments \(2\)/);
  assert.equal(result.markdown.match(/WHAT_THE_HELL/g)?.length, 1);
  assert.equal(result.metadata.author, "몽골리안갱뱅크림파이");
  assert.equal(result.metadata.views, 918);
  assert.equal(result.metadata.recommends, 0);
  assert.equal(result.metadata.comment_count, 2);
  assert.equal(result.metadata.domain, "ruliweb.com");
  assert.equal(result.metadata.site, "루리웹");
  assert.ok((result.metadata.word_count ?? 0) > 0);
  assert.equal(result.metadata.status, 200);
  assert.equal(result.metadata.content_type, "text/html");
});
