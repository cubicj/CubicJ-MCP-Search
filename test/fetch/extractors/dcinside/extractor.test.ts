import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test, vi } from "vitest";
import { fetchComments, fetchPage } from "../../../../src/fetch/extractors/dcinside/client.js";
import { URLS } from "../../../../src/fetch/extractors/dcinside/endpoints.js";
import {
  dcinsideExtractor,
  parseDcPostUrl,
  renderDcPost,
} from "../../../../src/fetch/extractors/dcinside/extractor.js";
import { parsePostDetail } from "../../../../src/fetch/extractors/dcinside/parse.js";

vi.mock("../../../../src/fetch/extractors/dcinside/client.js", () => ({
  fetchComments: vi.fn(),
  fetchPage: vi.fn(),
}));

const fixturesUrl = new URL("../../fixtures/", import.meta.url);
const mockedFetchComments = vi.mocked(fetchComments);
const mockedFetchPage = vi.mocked(fetchPage);
const session = { cookies: "session=cookie", esno: "token" };

async function readFixture(name: string): Promise<string> {
  return readFile(new URL(name, fixturesUrl), "utf8");
}

function rawComment(index: number, body: string) {
  return {
    no: index,
    memo: body,
    name: `user-${index}`,
    user_id: `user-id-${index}`,
    reg_date: "2026-06-25 13:14:15",
    del_yn: "N",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

test("parseDcPostUrl extracts gallery, index, and minor flag", () => {
  assert.deepEqual(parseDcPostUrl(new URL("https://gall.dcinside.com/mgallery/board/view/?id=coffee&no=12345")), {
    galleryId: "coffee",
    articleIndex: 12345,
    isMinor: true,
  });
  assert.deepEqual(parseDcPostUrl(new URL("https://gall.dcinside.com/programming/2937772")), {
    galleryId: "programming",
    articleIndex: 2937772,
    isMinor: false,
  });
  assert.equal(parseDcPostUrl(new URL("https://gall.dcinside.com/board/lists/?id=programming")), null);
  assert.equal(parseDcPostUrl(new URL("https://gall.dcinside.com/board/lists/?id=programming&no=123")), null);
  assert.equal(parseDcPostUrl(new URL("https://gall.dcinside.com/board/view/?id=programming&no=123abc")), null);
});

test("renderDcPost renders body, comments, and metadata", async () => {
  const html = await readFixture("post-detail.html");
  const { detail } = parsePostDetail(html, "coffee");
  const comments = [
    {
      index: 1001,
      body: "Visible comment",
      user: { name: "commenter", userId: "commenter-id", ip: null },
      time: new Date("2026-06-25 13:14:15"),
    },
    {
      index: 1002,
      body: '<a href="javascript:focusComment(1001);" class="mention">@commenter</a> reply<br>second line',
      user: { name: "anon", userId: null, ip: "1.2" },
      time: new Date("2026-06-25 14:15:16"),
    },
  ];

  const result = renderDcPost(detail, comments);

  assert.equal(result.extractor, "dcinside");
  assert.equal(result.title, "Post title");
  assert.equal(
    result.markdown,
    [
      "Line one",
      "Line two & more",
      "",
      "## Comments (2)",
      "",
      `- **commenter** (${new Date("2026-06-25 13:14:15").toISOString()}): Visible comment`,
      `- **anon(1.2)** (${new Date("2026-06-25 14:15:16").toISOString()}): @commenter reply second line`,
    ].join("\n"),
  );
  assert.deepEqual(result.metadata, {
    author: "writer",
    published: new Date("2026-06-25 12:13:14").toISOString(),
    domain: "gall.dcinside.com",
    site: "coffee",
    views: 100,
    recommends: 12,
    comment_count: 2,
  });
});

test("renderDcPost without comments renders body only", async () => {
  const html = await readFixture("post-detail.html");
  const { detail } = parsePostDetail(html, "coffee");

  const result = renderDcPost(detail, []);

  assert.equal(result.extractor, "dcinside");
  assert.equal(result.markdown, "Line one\nLine two & more");
  assert.equal(result.metadata.comment_count, 0);
});

test("dcinsideExtractor fetches all comment pages and renders them in reverse page order", async () => {
  const html = await readFixture("post-detail.html");
  mockedFetchPage.mockResolvedValue({ html, session, finalUrl: URLS.POST_VIEW });
  mockedFetchComments
    .mockResolvedValueOnce({ total_cnt: 300, comments: [rawComment(101, "page-one")] })
    .mockResolvedValueOnce({ total_cnt: 300, comments: [rawComment(201, "page-two")] })
    .mockResolvedValueOnce({ total_cnt: 300, comments: [rawComment(301, "page-three")] });

  const result = await dcinsideExtractor.extract("https://gall.dcinside.com/board/view/?id=coffee&no=12345");

  assert.deepEqual(
    mockedFetchComments.mock.calls.map((call) => call[4]),
    [1, 2, 3],
  );
  assert.equal(mockedFetchComments.mock.calls.length, 3);
  assert.ok(result.markdown.indexOf("page-three") < result.markdown.indexOf("page-two"));
  assert.ok(result.markdown.indexOf("page-two") < result.markdown.indexOf("page-one"));
  assert.equal(result.metadata.comment_count, 3);
  assert.equal(result.extractor, "dcinside");
});

test("dcinsideExtractor stops comment pagination when a page is empty", async () => {
  const html = await readFixture("post-detail.html");
  mockedFetchPage.mockResolvedValue({ html, session, finalUrl: URLS.POST_VIEW });
  mockedFetchComments
    .mockResolvedValueOnce({ total_cnt: 500, comments: [rawComment(101, "page-one")] })
    .mockResolvedValueOnce({ total_cnt: 500, comments: [] });

  const result = await dcinsideExtractor.extract("https://gall.dcinside.com/board/view/?id=coffee&no=12345");

  assert.deepEqual(
    mockedFetchComments.mock.calls.map((call) => call[4]),
    [1, 2],
  );
  assert.equal(result.metadata.comment_count, 1);
});

test("dcinsideExtractor selects the minor and major post view endpoints", async () => {
  const html = await readFixture("post-detail.html");
  mockedFetchPage.mockResolvedValue({ html, session, finalUrl: URLS.POST_VIEW });
  mockedFetchComments.mockResolvedValue({ total_cnt: 0, comments: [] });

  await dcinsideExtractor.extract("https://gall.dcinside.com/mgallery/board/view/?id=coffee&no=12345");
  await dcinsideExtractor.extract("https://gall.dcinside.com/board/view/?id=coffee&no=12345");

  assert.deepEqual(
    mockedFetchPage.mock.calls.map((call) => call[0]),
    [`${URLS.MINOR_POST_VIEW}?id=coffee&no=12345`, `${URLS.POST_VIEW}?id=coffee&no=12345`],
  );
});

test("dcinsideExtractor propagates comment client failures", async () => {
  const html = await readFixture("post-detail.html");
  const error = new Error("comment request failed");
  mockedFetchPage.mockResolvedValue({ html, session, finalUrl: URLS.POST_VIEW });
  mockedFetchComments.mockRejectedValue(error);

  let thrown: unknown;
  try {
    await dcinsideExtractor.extract("https://gall.dcinside.com/board/view/?id=coffee&no=12345");
  } catch (caught) {
    thrown = caught;
  }

  assert.equal(thrown, error);
});
