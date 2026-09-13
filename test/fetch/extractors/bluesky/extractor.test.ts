import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import type { BlueskyProfile, BlueskyThreadNode } from "../../../../src/fetch/extractors/bluesky/client.js";
import {
  fetchAuthorFeed,
  fetchPostThread,
  fetchProfile,
  resolveDid,
} from "../../../../src/fetch/extractors/bluesky/client.js";
import { blueskyExtractor } from "../../../../src/fetch/extractors/bluesky/extractor.js";

vi.mock("../../../../src/fetch/extractors/bluesky/client.js", () => ({
  resolveDid: vi.fn(),
  fetchPostThread: vi.fn(),
  fetchProfile: vi.fn(),
  fetchAuthorFeed: vi.fn(),
}));

const mockedResolveDid = vi.mocked(resolveDid);
const mockedFetchPostThread = vi.mocked(fetchPostThread);
const mockedFetchProfile = vi.mocked(fetchProfile);
const mockedFetchAuthorFeed = vi.mocked(fetchAuthorFeed);

const thread: BlueskyThreadNode = {
  post: {
    uri: "at://did:plc:resolved/app.bsky.feed.post/post-key",
    author: { handle: "alice.bsky.social", displayName: "Alice" },
    record: { text: "Hello from Bluesky", createdAt: "2026-08-22T01:02:03.000Z" },
    replyCount: 0,
    likeCount: 2,
  },
};

const profile: BlueskyProfile = {
  handle: "alice.bsky.social",
  displayName: "Alice",
  description: "Profile text",
  followersCount: 10,
  followsCount: 4,
  postsCount: 3,
};

beforeEach(() => {
  vi.resetAllMocks();
});

test("extracts posts and resolves only handle actors", async () => {
  mockedResolveDid.mockResolvedValue("did:plc:resolved");
  mockedFetchPostThread.mockResolvedValue(thread);

  const handleResult = await blueskyExtractor.extract("https://bsky.app/profile/alice.bsky.social/post/post-key");
  const didResult = await blueskyExtractor.extract("https://bsky.app/profile/did:plc:direct/post/post-key");

  assert.equal(handleResult.extractor, "bluesky");
  assert.equal(didResult.extractor, "bluesky");
  assert.deepEqual(mockedResolveDid.mock.calls, [["alice.bsky.social"]]);
  assert.deepEqual(mockedFetchPostThread.mock.calls, [
    ["did:plc:resolved", "post-key"],
    ["did:plc:direct", "post-key"],
  ]);
});

test("extracts profiles with profile details and author feed", async () => {
  mockedFetchProfile.mockResolvedValue(profile);
  mockedFetchAuthorFeed.mockResolvedValue([{ post: thread.post }]);

  const result = await blueskyExtractor.extract("https://bsky.app/profile/alice.bsky.social");

  assert.equal(result.extractor, "bluesky");
  assert.deepEqual(mockedFetchProfile.mock.calls, [["alice.bsky.social"]]);
  assert.deepEqual(mockedFetchAuthorFeed.mock.calls, [["alice.bsky.social"]]);
});
