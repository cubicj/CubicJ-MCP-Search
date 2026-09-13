import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { parseComments, parsePostDetail } from "../../../../src/fetch/extractors/dcinside/parse.js";

const fixturesUrl = new URL("../../fixtures/", import.meta.url);
const currentYear = new Date().getFullYear();

async function readFixture(name: string): Promise<string> {
  return readFile(new URL(name, fixturesUrl), "utf8");
}

test("parsePostDetail parses post detail markup", async () => {
  const html = await readFixture("post-detail.html");

  const result = parsePostDetail(html, "coffee");

  assert.equal(result.galleryType, "M");
  assert.deepEqual(result.detail, {
    galleryId: "coffee",
    galleryName: "coffee",
    index: 12345,
    title: "Post title",
    header: "Header",
    time: new Date("2026-06-25 12:13:14"),
    user: {
      name: "writer",
      userId: "writer-id",
      ip: null,
    },
    view: 100,
    recommend: 12,
    body: "Line one<br>Line two &amp; more",
    isMinor: true,
  });
});

test("parseComments keeps visible comments and computes total pages", async () => {
  const data = JSON.parse(await readFixture("comments.json"));

  const result = parseComments(data);

  assert.deepEqual(result, {
    totalPage: 1,
    comments: [
      {
        index: 1001,
        body: "Visible comment",
        user: {
          name: "commenter",
          userId: "commenter-id",
          ip: null,
        },
        time: new Date(`${currentYear}-06-25 13:14:15`),
      },
    ],
  });
});
