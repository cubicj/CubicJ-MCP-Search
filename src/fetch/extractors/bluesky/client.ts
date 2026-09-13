import { type FetchedDocument, fetchDocument } from "../../fetch.js";

const API_ROOT = "https://public.api.bsky.app/xrpc";
const API_HEADERS = { Accept: "application/json" };

export interface BlueskyPost {
  uri: string;
  author: { handle: string; displayName?: string };
  record: { text: string; createdAt: string };
  embed?: unknown;
  replyCount?: number;
  likeCount?: number;
}

export interface BlueskyThreadNode {
  post: BlueskyPost;
  replies?: BlueskyThreadReply[];
}

export interface BlueskyThreadViewPost extends BlueskyThreadNode {
  $type: "app.bsky.feed.defs#threadViewPost";
}

export interface BlueskyNotFoundPost {
  $type: "app.bsky.feed.defs#notFoundPost";
  uri: string;
  notFound: true;
}

export interface BlueskyBlockedPost {
  $type: "app.bsky.feed.defs#blockedPost";
  uri: string;
  blocked: true;
}

export type BlueskyThreadReply = BlueskyThreadViewPost | BlueskyNotFoundPost | BlueskyBlockedPost;

export interface BlueskyProfile {
  handle: string;
  displayName?: string;
  description?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
}

export interface BlueskyFeedItem {
  post: BlueskyPost;
}

function errorMessage(document: FetchedDocument): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(document.text);
  } catch {
    return document.statusText || `HTTP ${document.status}`;
  }
  if (typeof parsed === "object" && parsed !== null && "message" in parsed && typeof parsed.message === "string") {
    return parsed.message;
  }
  return document.statusText || `HTTP ${document.status}`;
}

function requireSuccess(document: FetchedDocument): void {
  if (document.status < 200 || document.status >= 300) {
    throw new Error(`Bluesky API error: ${document.status} ${errorMessage(document)}`);
  }
}

export async function fetchBlueskyJson<T>(url: string): Promise<T> {
  const document = await fetchDocument(url, { headers: API_HEADERS });
  requireSuccess(document);
  return JSON.parse(document.text) as T;
}

function fetchJson<T>(path: string, parameters: URLSearchParams): Promise<T> {
  return fetchBlueskyJson(`${API_ROOT}/${path}?${parameters}`);
}

export async function resolveDid(actor: string): Promise<string> {
  const result = await fetchJson<{ did: string }>(
    "com.atproto.identity.resolveHandle",
    new URLSearchParams({ handle: actor }),
  );
  return result.did;
}

export async function fetchPostThread(did: string, rkey: string): Promise<BlueskyThreadNode> {
  const result = await fetchJson<{ thread: BlueskyThreadNode }>(
    "app.bsky.feed.getPostThread",
    new URLSearchParams({
      uri: `at://${did}/app.bsky.feed.post/${rkey}`,
      depth: "10",
      parentHeight: "0",
    }),
  );
  return result.thread;
}

export function fetchProfile(actor: string): Promise<BlueskyProfile> {
  return fetchJson("app.bsky.actor.getProfile", new URLSearchParams({ actor }));
}

export async function fetchAuthorFeed(actor: string): Promise<BlueskyFeedItem[]> {
  const result = await fetchJson<{ feed: BlueskyFeedItem[] }>(
    "app.bsky.feed.getAuthorFeed",
    new URLSearchParams({ actor, limit: "30", filter: "posts_no_replies" }),
  );
  return result.feed;
}
