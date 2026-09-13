import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { test } from "vitest";
import { parseRuliwebPost, parseRuliwebUrl } from "../../../../src/fetch/extractors/ruliweb/parse.js";

const fixtureUrl = new URL("../../fixtures/ruliweb/post.html", import.meta.url);

test("parseRuliwebUrl recognizes both supported post URL shapes", () => {
  assert.deepEqual(parseRuliwebUrl(new URL("https://bbs.ruliweb.com/community/board/300143/read/70000000")), {
    section: "community",
    board: "300143",
    id: "70000000",
  });
  assert.deepEqual(parseRuliwebUrl(new URL("https://m.ruliweb.com/news/read/70000000")), {
    section: "news",
    board: null,
    id: "70000000",
  });
});

test("parseRuliwebUrl rejects listing URLs", () => {
  assert.equal(parseRuliwebUrl(new URL("https://bbs.ruliweb.com/best")), null);
});

test("Ruliweb fixture retains the selectors verified against the live post", async () => {
  const html = await readFile(fixtureUrl, "utf8");
  const $ = load(html);

  assert.equal($(".subject_inner_text").length, 1);
  assert.equal($(".user_view").length, 1);
  assert.equal($(".user_info").length, 1);
  assert.equal($(".view_content").length, 1);
  assert.equal($(".comment_element").length, 3);
  assert.equal($(".comment_element.child").length, 1);
  assert.equal($(".comment_element .nick").length, 3);
  assert.equal($(".comment_element .time").length, 3);
  assert.equal($(".comment_element .text_wrapper .text").length, 3);
});

test("parseRuliwebPost extracts post metadata and unique comments", async () => {
  const html = await readFile(fixtureUrl, "utf8");
  const $ = load(html);
  const fixtureCommentIds = $(".comment_element")
    .toArray()
    .map((element) => $(element).attr("id"));
  const result = parseRuliwebPost(html);

  assert.equal(result.title, "스팀OS데탑버전 언제 출시하지");
  assert.equal(result.author, "몽골리안갱뱅크림파이");
  assert.equal(result.published, "2025.03.24 (02:52:21)");
  assert.equal(result.views, 918);
  assert.equal(result.recommends, 0);
  assert.equal(new Set(fixtureCommentIds).size, 2);
  assert.equal(result.comments.length, 2);
  assert.equal(result.comments[0]?.author, "WHAT_THE_HELL (1042802)");
  assert.equal(result.comments[1]?.time, "25.03.24 02:59");
  assert.equal(result.comments[1]?.text, "구형노트북?");
  assert.equal(result.comments[1]?.depth, 1);
  const identities = result.comments.map(({ author, time, text }) => `${author}\n${time}\n${text}`);
  assert.equal(new Set(identities).size, result.comments.length);
});

test("parseRuliwebPost renders comment images as placeholders", async () => {
  const html = await readFile(fixtureUrl, "utf8");
  const $ = load(html);
  $(".comment_element.normal .text_wrapper").first().append('<img src="https://example.com/comment.png">');

  const result = parseRuliwebPost($.html());

  assert.match(result.comments[0]?.text ?? "", /\[image\]/);
});
