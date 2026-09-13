import type { Extractor } from "../types.js";
import { fetchAuthorFeed, fetchPostThread, fetchProfile, resolveDid } from "./client.js";
import { parseBlueskyUrl, renderBlueskyProfile, renderBlueskyThread } from "./parse.js";

export const blueskyExtractor: Extractor = {
  name: "bluesky",
  matches: (url) => parseBlueskyUrl(url) !== null,
  async extract(url) {
    const parsed = parseBlueskyUrl(new URL(url));
    if (!parsed) throw new Error(`Not a Bluesky URL: ${url}`);
    if (parsed.kind === "post") {
      const did = parsed.actor.startsWith("did:") ? parsed.actor : await resolveDid(parsed.actor);
      return renderBlueskyThread(url, await fetchPostThread(did, parsed.rkey));
    }
    const [profile, feed] = await Promise.all([fetchProfile(parsed.actor), fetchAuthorFeed(parsed.actor)]);
    return renderBlueskyProfile(url, profile, feed);
  },
};
