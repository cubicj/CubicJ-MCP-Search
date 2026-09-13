import type { ExtractResult } from "../types.js";
import type { BlueskyFeedItem, BlueskyPost, BlueskyProfile, BlueskyThreadNode, BlueskyThreadReply } from "./client.js";

export type ParsedBlueskyUrl = { kind: "post"; actor: string; rkey: string } | { kind: "profile"; actor: string };

export function parseBlueskyUrl(url: URL): ParsedBlueskyUrl | null {
  if (url.hostname !== "bsky.app") return null;

  const postMatch = url.pathname.match(/^\/profile\/([^/]+)\/post\/([^/]+)\/?$/);
  if (postMatch) return { kind: "post", actor: postMatch[1], rkey: postMatch[2] };

  const profileMatch = url.pathname.match(/^\/profile\/([^/]+)\/?$/);
  return profileMatch ? { kind: "profile", actor: profileMatch[1] } : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function nestedObject(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return objectValue(value[key]);
}

function stringValue(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === "string" ? value[key] : null;
}

function renderRecordEmbed(embed: Record<string, unknown>): string[] {
  const record = nestedObject(embed, "record");
  const author = record ? nestedObject(record, "author") : null;
  const value = record ? nestedObject(record, "value") : null;
  const handle = author ? stringValue(author, "handle") : null;
  const text = value ? stringValue(value, "text") : null;
  return handle && text !== null ? [`Quoted: @${handle}:${text ? ` ${text}` : ""}`] : [];
}

function renderEmbed(embedValue: unknown): string[] {
  const embed = objectValue(embedValue);
  if (!embed) return [];

  const type = stringValue(embed, "$type");
  if (type === "app.bsky.embed.external#view") {
    const external = nestedObject(embed, "external");
    const title = external ? stringValue(external, "title") : null;
    const uri = external ? stringValue(external, "uri") : null;
    return title && uri ? [`[${title}](${uri})`] : [];
  }

  if (type === "app.bsky.embed.images#view") {
    const images = Array.isArray(embed.images) ? embed.images : [];
    return images.flatMap((image) => {
      const parsed = objectValue(image);
      const alt = parsed ? stringValue(parsed, "alt") : null;
      return alt === null ? [] : [`[image: ${alt}]`];
    });
  }

  if (type === "app.bsky.embed.record#view") return renderRecordEmbed(embed);

  if (type === "app.bsky.embed.recordWithMedia#view") {
    return [...renderEmbed(embed.record), ...renderEmbed(embed.media)];
  }

  return [];
}

function postLines(post: BlueskyPost): string[] {
  return [`**@${post.author.handle}** · ${post.record.createdAt}`, post.record.text, ...renderEmbed(post.embed)];
}

function replyLines(node: BlueskyThreadReply, depth: number): string[] {
  const prefix = ">".repeat(depth);
  if (node.$type === "app.bsky.feed.defs#notFoundPost") return [`${prefix} [unavailable post]`];
  if (node.$type === "app.bsky.feed.defs#blockedPost") return [`${prefix} [blocked post]`];
  const lines = postLines(node.post).flatMap((line) => line.split("\n").map((part) => `${prefix} ${part}`));
  for (const reply of node.replies ?? []) {
    lines.push("", ...replyLines(reply, depth + 1));
  }
  return lines;
}

function postTitle(post: BlueskyPost): string {
  const firstLine = post.record.text.split("\n", 1)[0].trim();
  return firstLine ? firstLine.slice(0, 80) : `Post by @${post.author.handle}`;
}

export function renderBlueskyThread(_url: string, thread: BlueskyThreadNode): ExtractResult {
  const lines = postLines(thread.post);
  if (thread.replies?.length) {
    lines.push("", "## Replies", "");
    thread.replies.forEach((reply, index) => {
      if (index > 0) lines.push("");
      lines.push(...replyLines(reply, 1));
    });
  }

  return {
    title: postTitle(thread.post),
    markdown: lines.join("\n"),
    metadata: {
      author: thread.post.author.handle,
      published: thread.post.record.createdAt,
      domain: "bsky.app",
      site: "Bluesky",
      comment_count: thread.post.replyCount,
      recommends: thread.post.likeCount,
    },
    extractor: "bluesky",
  };
}

function feedPostLines(item: BlueskyFeedItem): string[] {
  const rkey = item.post.uri.split("/").at(-1) ?? "";
  const postUrl = `https://bsky.app/profile/${item.post.author.handle}/post/${rkey}`;
  return [`**${item.post.record.createdAt}** · [link](${postUrl})`, item.post.record.text];
}

export function renderBlueskyProfile(_url: string, profile: BlueskyProfile, feed: BlueskyFeedItem[]): ExtractResult {
  const title = profile.displayName || profile.handle;
  const lines = [`# ${title}`, `@${profile.handle}`];
  if (profile.description) lines.push("", profile.description);
  lines.push(
    "",
    `Followers: ${profile.followersCount ?? 0} · Following: ${profile.followsCount ?? 0} · Posts: ${profile.postsCount ?? 0}`,
    "",
    "## Recent posts",
  );
  for (const item of feed) lines.push("", ...feedPostLines(item));

  return {
    title,
    markdown: lines.join("\n"),
    metadata: {
      author: profile.handle,
      ...(profile.description ? { description: profile.description } : {}),
      domain: "bsky.app",
      site: "Bluesky",
    },
    extractor: "bluesky",
  };
}
