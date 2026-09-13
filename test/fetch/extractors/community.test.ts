import assert from "node:assert/strict";
import { test } from "vitest";
import { extractScopedMarkdown, renderComments } from "../../../src/fetch/extractors/community.js";
import { NO_CONTENT_NOTICE } from "../../../src/fetch/extractors/generic.js";

test("renders nested comments as quotes", () => {
  const markdown = renderComments([
    { author: "a", time: "2026-08-22 10:00", text: "first\nsecond", depth: 0 },
    { author: "b", time: "2026-08-22 10:05", text: "reply", depth: 1 },
  ]);
  assert.equal(
    markdown,
    [
      "## Comments (2)",
      "",
      "**a** · 2026-08-22 10:00",
      "first",
      "second",
      "",
      "> **b** · 2026-08-22 10:05",
      "> reply",
    ].join("\n"),
  );
  assert.equal(renderComments([]), "");
  assert.equal(
    renderComments([{ author: "c", time: "2026-08-22 10:10", text: "best", depth: 0 }], "Best comments"),
    ["## Best comments (1)", "", "**c** · 2026-08-22 10:10", "best"].join("\n"),
  );
});

test("extractScopedMarkdown limits Defuddle to the selector", async () => {
  const html = "<html><body><nav>menu</nav><div class='body'><p>Real body text here.</p></div></body></html>";
  const result = await extractScopedMarkdown(html, "https://example.com/p/1", ".body");
  assert.match(result.markdown, /Real body text here\./);
  assert.doesNotMatch(result.markdown, /menu/);
  assert.ok(result.wordCount > 0);
});

test("extractScopedMarkdown falls back to the whole document when the selector is missing", async () => {
  const html =
    "<html><body><main><p>Whole document fallback content remains readable when the selector is missing.</p></main></body></html>";
  const result = await extractScopedMarkdown(html, "https://example.com/p/2", ".missing");
  assert.match(result.markdown, /Whole document fallback content remains readable/);
});

test("extractScopedMarkdown returns the no-content notice and zero word count when empty", async () => {
  const result = await extractScopedMarkdown("<html><body></body></html>", "https://example.com/p/3", ".missing");
  assert.equal(result.markdown, NO_CONTENT_NOTICE);
  assert.equal(result.wordCount, 0);
});
