import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { test } from "vitest";
import { findContentContainer, parseNamuWikiUrl } from "../../../../src/fetch/extractors/namu-wiki/parse.js";

const fixtureUrl = new URL("../../fixtures/namu-wiki/page.html", import.meta.url);

test("parseNamuWikiUrl recognizes decoded article titles", () => {
  assert.deepEqual(parseNamuWikiUrl(new URL("https://namu.wiki/w/%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD")), {
    title: "대한민국",
  });
});

test("parseNamuWikiUrl rejects non-article and foreign URLs", () => {
  assert.equal(parseNamuWikiUrl(new URL("https://namu.wiki/RecentChanges")), null);
  assert.equal(parseNamuWikiUrl(new URL("https://example.com/w/%EB%8C%80%ED%95%9C%EB%AF%BC%EA%B5%AD")), null);
});

test("findContentContainer returns the lowest common ancestor of article headings", async () => {
  const html = await readFile(fixtureUrl, "utf8");
  const document = new JSDOM(html).window.document;

  const container = findContentContainer(document);

  assert.equal(container?.id, "article-sections");
});

test("findContentContainer returns null when fewer than two section headings exist", () => {
  const document = new JSDOM("<body><div><h2>Only section</h2></div></body>").window.document;

  assert.equal(findContentContainer(document), null);
});
