import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { test } from "vitest";
import { parseClienPost, parseClienUrl } from "../../../../src/fetch/extractors/clien/parse.js";

const fixtureUrl = new URL("../../fixtures/clien/post.html", import.meta.url);

test("parseClienUrl recognizes post URLs on supported hosts", () => {
  const urls = [
    "https://www.clien.net/service/board/park/18977000",
    "https://m.clien.net/service/board/park/18977000",
    "https://clien.net/service/board/park/18977000",
  ];

  for (const url of urls) {
    assert.deepEqual(parseClienUrl(new URL(url)), { board: "park", id: "18977000" }, url);
  }
});

test("parseClienUrl rejects board listing URLs", () => {
  assert.equal(parseClienUrl(new URL("https://www.clien.net/service/board/park")), null);
});

test("Clien fixture retains the selectors verified against the live post", async () => {
  const html = await readFile(fixtureUrl, "utf8");
  const $ = load(html);

  assert.equal($(".post_title").length, 1);
  assert.equal($(".post_subject span:not(.post_category)").length, 2);
  assert.equal($(".post_author").length, 1);
  assert.equal($(".post_author .nickname").length, 0);
  assert.equal($(".post_info .nickname").length, 1);
  assert.equal($(".post_article").length, 1);
  assert.equal($(".symph_count").length, 1);
  assert.equal($(".comment_row").length, 3);
  assert.equal($(".comment_row.re").length, 1);
  assert.equal($(".comment_row .nickname img[alt]").length, 1);
  assert.equal($(".comment_time").length, 3);
  assert.equal($(".comment_content").length, 3);
});

test("parseClienPost extracts post metadata and the first three comments", async () => {
  const html = await readFile(fixtureUrl, "utf8");
  const result = parseClienPost(html);

  assert.equal(result.title, "퓰리처상급 김문수 유세 사진");
  assert.equal(result.author, "dramarama");
  assert.equal(result.published, "2025-05-15 14:59:26");
  assert.equal(result.views, 24790);
  assert.equal(result.recommends, 22);
  assert.equal(result.comments.length, 3);
  assert.equal(result.comments[0]?.time, "2025-05-15 15:07:20");
  assert.equal(result.comments[1]?.author, "스친인연");
  assert.equal(result.comments[2]?.depth, 1);
  assert.equal(result.comments[2]?.text, "@스친인연님\n순대차가 먼저 이 자리에서 계속 장사했을 건데 말이에요");
});

test("parseClienPost falls back to the short comment timestamp", () => {
  const result = parseClienPost(`
    <div class="comment_row">
      <span class="nickname">작성자</span>
      <div class="comment_time">25-05-15</div>
      <div class="comment_content">댓글</div>
    </div>
  `);

  assert.equal(result.comments[0]?.time, "25-05-15");
});
