import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { test } from "vitest";
import { parseFmkoreaPost, parseFmkoreaUrl } from "../../../../src/fetch/extractors/fmkorea/parse.js";

const fixtureUrl = new URL("../../fixtures/fmkorea/post.html", import.meta.url);

test("parseFmkoreaUrl recognizes all supported post URL shapes", () => {
  const urls = [
    "https://www.fmkorea.com/10242315214",
    "https://m.fmkorea.com/humor/10242315214",
    "https://fmkorea.com/index.php?document_srl=10242315214",
    "https://www.fmkorea.com/index.php?mid=humor&document_srl=10242315214",
  ];

  for (const url of urls) {
    assert.deepEqual(parseFmkoreaUrl(new URL(url)), { id: "10242315214" }, url);
  }
});

test("parseFmkoreaUrl rejects listing URLs", () => {
  assert.equal(parseFmkoreaUrl(new URL("https://www.fmkorea.com/best")), null);
  assert.equal(parseFmkoreaUrl(new URL("https://www.fmkorea.com/humor")), null);
});

test("FMKorea fixture retains the selectors verified against the live post", async () => {
  const html = await readFile(fixtureUrl, "utf8");
  const $ = load(html);

  assert.equal($(".np_18px").length, 1);
  assert.equal($(".np_18px span").length, 2);
  assert.equal($(".rd_hd .member_plate").length, 1);
  assert.equal($(".rd_hd .date.m_no").length, 1);
  assert.equal($("article .xe_content").length, 1);
  assert.equal($(".rd_body").length, 1);
  assert.equal($(".side.fr b").length, 3);
  assert.equal($(".btn_img.vote_up b").length, 0);
  assert.equal($(".fdb_itm").length, 4);
  assert.equal($(".fdb_itm.comment_best").length, 1);
  assert.equal($(".fdb_itm.comment-2").length, 1);
  assert.equal($(".fdb_itm.re").length, 1);
  assert.equal($(".fdb_itm .member_plate").length, 4);
  assert.equal($(".fdb_itm .date").length, 4);
  assert.equal($(".fdb_itm .comment-content").length, 4);
  assert.equal($(".top_hotdeal").length, 2);
  assert.match($(".top_hotdeal").first().text(), /\[아이허브\] 라이프익스텐션/);
});

test("parseFmkoreaPost extracts post metadata, best comments, and nested comments", async () => {
  const html = await readFile(fixtureUrl, "utf8");
  const result = parseFmkoreaPost(html);

  assert.equal(result.title, "(약혐) 세계적으로 거부감 가진다는 AI 메뉴판들");
  assert.equal(result.author, "마키키");
  assert.equal(result.published, "2026.08.22 10:22");
  assert.equal(result.views, 528458);
  assert.equal(result.recommends, null);
  assert.equal(result.bestComments.length, 1);
  assert.equal(result.bestComments[0]?.depth, 1);
  assert.equal(result.comments.length, 3);
  assert.ok(result.comments.some((comment) => comment.depth >= 1));
  assert.equal(result.comments[2]?.author, "그냥유학생이지요");
  assert.equal(result.comments[2]?.text, "@저때문에화났나유 ㄹㅇ");
});
