import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  parseBlueskyUrl,
  renderBlueskyProfile,
  renderBlueskyThread,
} from "../../../../src/fetch/extractors/bluesky/parse.js";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../fixtures/bluesky/${name}`, import.meta.url), "utf8"));

test("parses post and profile URLs", () => {
  assert.deepEqual(parseBlueskyUrl(new URL("https://bsky.app/profile/bsky.app/post/3l6oveex3ii2l")), {
    kind: "post",
    actor: "bsky.app",
    rkey: "3l6oveex3ii2l",
  });
  assert.deepEqual(parseBlueskyUrl(new URL("https://bsky.app/profile/did:plc:abc")), {
    kind: "profile",
    actor: "did:plc:abc",
  });
  assert.equal(parseBlueskyUrl(new URL("https://bsky.app/search?q=x")), null);
  assert.equal(parseBlueskyUrl(new URL("https://example.com/profile/x")), null);
});

test("renders a thread with replies", () => {
  const { thread } = fixture("thread.json");
  const result = renderBlueskyThread("https://bsky.app/profile/bsky.app/post/3l6oveex3ii2l", thread);
  assert.equal(result.extractor, "bluesky");
  assert.equal(result.metadata.author, "bsky.app");
  assert.equal(result.metadata.site, "Bluesky");
  assert.match(result.markdown, /^\*\*@bsky\.app\*\* · /);
  assert.match(result.markdown, /\n## Replies\n/);
  assert.match(result.markdown, /\n> \*\*@/);
  assert.equal(result.title.length <= 80, true);
});

test("renders supported embeds and nested reply depth", () => {
  const thread = {
    post: {
      uri: "at://did:plc:root/app.bsky.feed.post/root",
      author: { handle: "root.bsky.social" },
      record: { text: "Root post", createdAt: "2026-08-22T00:00:00.000Z" },
      embed: {
        $type: "app.bsky.embed.recordWithMedia#view",
        record: {
          $type: "app.bsky.embed.record#view",
          record: { author: { handle: "quoted.bsky.social" }, value: { text: "" } },
        },
        media: {
          $type: "app.bsky.embed.images#view",
          images: [{ alt: "A blue butterfly" }],
        },
      },
    },
    replies: [
      {
        post: {
          uri: "at://did:plc:reply/app.bsky.feed.post/reply",
          author: { handle: "reply.bsky.social" },
          record: { text: "Reply", createdAt: "2026-08-22T00:01:00.000Z" },
          embed: {
            $type: "app.bsky.embed.external#view",
            external: { title: "Bluesky docs", uri: "https://docs.bsky.app/" },
          },
        },
        replies: [
          {
            post: {
              uri: "at://did:plc:nested/app.bsky.feed.post/nested",
              author: { handle: "nested.bsky.social" },
              record: { text: "Nested", createdAt: "2026-08-22T00:02:00.000Z" },
            },
          },
        ],
      },
    ],
  };

  const result = renderBlueskyThread("https://bsky.app/profile/root.bsky.social/post/root", thread);

  assert.match(result.markdown, /^Quoted: @quoted\.bsky\.social:$/m);
  assert.match(result.markdown, /^\[image: A blue butterfly\]$/m);
  assert.match(result.markdown, /^> \[Bluesky docs\]\(https:\/\/docs\.bsky\.app\/\)$/m);
  assert.match(result.markdown, /^>> \*\*@nested\.bsky\.social\*\* · /m);
});

test("renders unavailable replies and continues the thread", () => {
  const thread = {
    post: {
      uri: "at://did:plc:root/app.bsky.feed.post/root",
      author: { handle: "root.bsky.social" },
      record: { text: "Root post", createdAt: "2026-08-22T00:00:00.000Z" },
    },
    replies: [
      {
        $type: "app.bsky.feed.defs#notFoundPost",
        uri: "at://did:plc:missing/app.bsky.feed.post/missing",
        notFound: true,
      },
      {
        $type: "app.bsky.feed.defs#blockedPost",
        uri: "at://did:plc:blocked/app.bsky.feed.post/blocked",
        blocked: true,
      },
      {
        $type: "app.bsky.feed.defs#threadViewPost",
        post: {
          uri: "at://did:plc:reply/app.bsky.feed.post/reply",
          author: { handle: "reply.bsky.social" },
          record: { text: "Available reply", createdAt: "2026-08-22T00:01:00.000Z" },
        },
      },
    ],
  };

  const result = renderBlueskyThread("https://bsky.app/profile/root.bsky.social/post/root", thread);

  assert.match(result.markdown, /^> \[unavailable post\]$/m);
  assert.match(result.markdown, /^> \[blocked post\]$/m);
  assert.match(result.markdown, /^> \*\*@reply\.bsky\.social\*\* · /m);
});

test("renders a profile with recent posts", () => {
  const profile = fixture("profile.json");
  const { feed } = fixture("feed.json");
  const result = renderBlueskyProfile("https://bsky.app/profile/bsky.app", profile, feed);
  assert.match(result.markdown, /^# /);
  assert.match(result.markdown, /@bsky\.app/);
  assert.match(result.markdown, /\n## Recent posts\n/);
  assert.equal(result.title, profile.displayName);
});
