import assert from "node:assert/strict";
import { test } from "vitest";
import { selectExtractor } from "../../../src/fetch/extractors/registry.js";

test("selectExtractor routes site posts to their extractors and everything else to generic", () => {
  const dcUrls = [
    "https://gall.dcinside.com/board/view/?id=programming&no=2937772",
    "https://gall.dcinside.com/mgallery/board/view/?id=projectmx&no=100",
    "https://gall.dcinside.com/board/programming/2937772",
    "https://gall.dcinside.com/mgallery/board/projectmx/100",
    "https://gall.dcinside.com/programming/2937772",
  ];
  for (const url of dcUrls) {
    assert.equal(selectExtractor(url).name, "dcinside", url);
  }

  const naverBlogUrls = [
    "https://blog.naver.com/PostView.naver?blogId=coffee&logNo=123",
    "https://m.blog.naver.com/PostView.nhn?blogId=coffee&logNo=123",
    "https://blog.naver.com/coffee/123",
    "https://m.blog.naver.com/coffee/123",
  ];
  for (const url of naverBlogUrls) {
    assert.equal(selectExtractor(url).name, "naver-blog", url);
  }

  const githubUrls = [
    "https://github.com/openai/codex",
    "https://www.github.com/openai/codex/blob/main/README.md",
    "https://github.com/openai/codex/issues/1",
    "https://github.com/openai/codex/pull/1",
    "https://gist.github.com/u/0123456789abcdef0123456789abcdef",
    "https://gist.github.com/defunkt/1078",
  ];
  for (const url of githubUrls) {
    assert.equal(selectExtractor(url).name, "github", url);
  }

  assert.equal(selectExtractor("https://bsky.app/profile/bsky.app/post/abc").name, "bluesky");
  assert.equal(selectExtractor("https://www.clien.net/service/board/park/18977000").name, "clien");
  const ruliwebUrls = [
    "https://bbs.ruliweb.com/community/board/300143/read/70000000",
    "https://m.ruliweb.com/news/read/70000000",
  ];
  for (const url of ruliwebUrls) {
    assert.equal(selectExtractor(url).name, "ruliweb", url);
  }
  const fmkoreaUrls = [
    "https://www.fmkorea.com/10242315214",
    "https://m.fmkorea.com/humor/10242315214",
    "https://fmkorea.com/index.php?document_srl=10242315214",
    "https://www.fmkorea.com/index.php?mid=humor&document_srl=10242315214",
  ];
  for (const url of fmkoreaUrls) {
    assert.equal(selectExtractor(url).name, "fmkorea", url);
  }
  assert.equal(selectExtractor("https://namu.wiki/w/%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD").name, "namu-wiki");

  const genericUrls = [
    "https://gall.dcinside.com/board/lists/?id=programming",
    "https://gall.dcinside.com/board/lists/?id=programming&no=123",
    "https://gall.dcinside.com/board/view/?id=programming&no=123abc",
    "https://gall.dcinside.com/",
    "https://www.dcinside.com/",
    "https://example.com/programming/123",
    "https://blog.naver.com/PostList.naver?blogId=coffee",
    "https://blog.naver.com/coffee",
    "https://blog.naver.com/coffee/not-digits",
    "https://github.com/openai",
    "https://github.com/openai/codex/tree/main",
    "https://github.com/openai/codex/pull/abc",
    "https://github.com/explore/topics",
    "https://bsky.app/search",
    "https://www.clien.net/service/board/park",
    "https://bbs.ruliweb.com/best",
    "https://www.fmkorea.com/best",
    "https://namu.wiki/RecentChanges",
  ];
  for (const url of genericUrls) {
    assert.equal(selectExtractor(url).name, "generic", url);
  }
});
