import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test, vi } from "vitest";
import { fmkoreaExtractor } from "../../../../src/fetch/extractors/fmkorea/extractor.js";
import { type FetchedDocument, fetchDocument } from "../../../../src/fetch/fetch.js";

vi.mock("../../../../src/fetch/fetch.js", () => ({
  fetchDocument: vi.fn(),
}));

const mockedFetchDocument = vi.mocked(fetchDocument);
const fixtureUrl = new URL("../../fixtures/fmkorea/post.html", import.meta.url);

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

test("fmkoreaExtractor extracts the scoped post body before best and regular comments", async () => {
  const html = await readFile(fixtureUrl, "utf8");
  const inputUrl = "https://m.fmkorea.com/humor/10242315214";
  const canonicalUrl = "https://www.fmkorea.com/10242315214";
  mockedFetchDocument.mockResolvedValue(fetchedDocument(html, canonicalUrl));

  const result = await fmkoreaExtractor.extract(inputUrl);

  assert.equal(mockedFetchDocument.mock.calls[0]?.[0], canonicalUrl);
  assert.equal(result.title, "(약혐) 세계적으로 거부감 가진다는 AI 메뉴판들");
  assert.equal(result.extractor, "fmkorea");
  assert.match(result.markdown, /아니 왜이리 무슨 뇌조직처럼 만들어진거지/);
  const bestHeading = result.markdown.indexOf("## Best comments (");
  const commentsHeading = result.markdown.indexOf("## Comments (");
  assert.ok(bestHeading >= 0);
  assert.ok(commentsHeading > bestHeading);
  assert.doesNotMatch(result.markdown, /\[아이허브\] 라이프익스텐션/);
  assert.equal(result.metadata.author, "마키키");
  assert.equal(result.metadata.views, 528458);
  assert.equal(result.metadata.recommends, undefined);
  assert.equal(result.metadata.comment_count, 4);
  assert.equal(result.metadata.domain, "fmkorea.com");
  assert.equal(result.metadata.site, "에펨코리아");
  assert.ok((result.metadata.word_count ?? 0) > 0);
  assert.equal(result.metadata.status, 200);
  assert.equal(result.metadata.content_type, "text/html");
});

test("fmkoreaExtractor falls back to the rd_body container", async () => {
  const html = `<!doctype html>
    <html>
      <body>
        <h1 class="np_18px"><span>Fallback title</span></h1>
        <div class="rd_body"><p>Fallback body content</p></div>
        <div>Outside fallback noise</div>
      </body>
    </html>`;
  const url = "https://www.fmkorea.com/10242315214";
  mockedFetchDocument.mockResolvedValue(fetchedDocument(html, url));

  const result = await fmkoreaExtractor.extract(url);

  assert.match(result.markdown, /Fallback body content/);
  assert.doesNotMatch(result.markdown, /Outside fallback noise/);
});
