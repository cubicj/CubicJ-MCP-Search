import assert from "node:assert/strict";
import { test } from "vitest";
import { buildMarkdownText } from "../../src/fetch/content.js";

test("buildMarkdownText renders every metadata field in the required order", () => {
  const text = buildMarkdownText(
    "Metadata Fixture",
    "https://example.com/original",
    {
      content_type: "text/html",
      final_url: "https://example.com/final",
      status: 200,
      word_count: 42,
      page_count: 5,
      comment_count: 3,
      recommends: 2,
      views: 10,
      domain: "example.com",
      site: "Example",
      description: "Description",
      published: "2026-08-22T00:00:00Z",
      author: "Author",
    },
    { content: "Body", total_length: 4, truncated: false, next_start_index: 4 },
  );

  assert.equal(
    text,
    [
      "# Metadata Fixture",
      "",
      "**URL**: https://example.com/original",
      "**Author**: Author",
      "**Published**: 2026-08-22T00:00:00Z",
      "**Description**: Description",
      "**Site**: Example",
      "**Domain**: example.com",
      "**Views**: 10",
      "**Recommends**: 2",
      "**Comments**: 3",
      "**Word count**: 42",
      "**Pages**: 5",
      "**Status**: 200",
      "**Final URL**: https://example.com/final",
      "**Content type**: text/html",
      "",
      "Body",
    ].join("\n"),
  );
});

test("buildMarkdownText omits absent metadata fields", () => {
  const text = buildMarkdownText(
    "Sparse Fixture",
    "https://example.com/",
    { status: 0, comment_count: 0 },
    { content: "Body", total_length: 4, truncated: false, next_start_index: 4 },
  );

  assert.equal(text, "# Sparse Fixture\n\n**URL**: https://example.com/\n**Comments**: 0\n**Status**: 0\n\nBody");
});
