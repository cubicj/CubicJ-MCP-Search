import type { ExtractResult, FetchMetadata } from "../types.js";
import type { GitHubComment, GitHubGist, GitHubIssue, GitHubPull, GitHubRepository } from "./client.js";

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const RESERVED_OWNERS = new Set([
  "orgs",
  "settings",
  "features",
  "marketplace",
  "topics",
  "explore",
  "sponsors",
  "login",
  "about",
  "pricing",
  "apps",
  "collections",
  "events",
  "notifications",
  "search",
  "site",
  "trending",
]);
const TEXT_EXTENSIONS = new Set(["md", "markdown", "mdx", "txt", "rst", "adoc"]);

export type ParsedGitHubUrl =
  | { kind: "gist"; id: string }
  | { kind: "file"; owner: string; repo: string; ref: string; path: string }
  | { kind: "issue"; owner: string; repo: string; number: number }
  | { kind: "pull"; owner: string; repo: string; number: number }
  | { kind: "repo"; owner: string; repo: string };

function parseNumber(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseGitHubUrl(url: URL): ParsedGitHubUrl | null {
  if (url.hostname === "gist.github.com") {
    const gistMatch = url.pathname.match(/^\/(?:[^/]+\/)?([0-9a-f]+)\/?$/);
    return gistMatch ? { kind: "gist", id: gistMatch[1] } : null;
  }

  if (!GITHUB_HOSTS.has(url.hostname)) return null;

  const fileMatch = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+)$/);
  if (fileMatch) {
    return { kind: "file", owner: fileMatch[1], repo: fileMatch[2], ref: fileMatch[3], path: fileMatch[4] };
  }

  const issueMatch = url.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)$/);
  if (issueMatch) {
    const number = parseNumber(issueMatch[3]);
    return number === null ? null : { kind: "issue", owner: issueMatch[1], repo: issueMatch[2], number };
  }

  const pullMatch = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/);
  if (pullMatch) {
    const number = parseNumber(pullMatch[3]);
    return number === null ? null : { kind: "pull", owner: pullMatch[1], repo: pullMatch[2], number };
  }

  const repoMatch = url.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
  if (!repoMatch || RESERVED_OWNERS.has(repoMatch[1].toLowerCase())) return null;
  return { kind: "repo", owner: repoMatch[1], repo: repoMatch[2] };
}

function fileExtension(path: string): string | null {
  const basename = path.split("/").at(-1) ?? "";
  const dot = basename.lastIndexOf(".");
  return dot > 0 && dot < basename.length - 1 ? basename.slice(dot + 1).toLowerCase() : null;
}

export function renderGitHubFile(path: string, text: string): string {
  const extension = fileExtension(path);
  if (!extension || TEXT_EXTENSIONS.has(extension)) return text;
  const fence = fenceFor(text);
  return `${fence}${extension}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}`;
}

function fenceFor(text: string): string {
  return text.includes("```") ? "````" : "```";
}

export function renderGitHubGist(
  document: { requestedUrl: string; status: number; contentType: string | null },
  gist: GitHubGist,
  contents: Record<string, string>,
): ExtractResult {
  const lines: string[] = [];
  for (const file of Object.values(gist.files)) {
    const text = contents[file.filename];
    const fence = fenceFor(text);
    lines.push(
      "",
      `## ${file.filename}`,
      "",
      `${fence}${file.language?.toLowerCase() ?? ""}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}`,
    );
  }

  return {
    title: gist.description?.trim() || `Gist ${gist.id}`,
    markdown: lines.join("\n"),
    metadata: {
      ...(gist.owner ? { author: gist.owner.login } : {}),
      published: gist.created_at,
      domain: "gist.github.com",
      status: document.status,
      ...(document.contentType ? { content_type: document.contentType } : {}),
    },
    extractor: "github",
  };
}

export function renderGitHubRepository(
  document: { requestedUrl: string; status: number; contentType: string | null },
  repository: GitHubRepository,
): ExtractResult {
  const description = repository.description?.trim();
  const lines = [description || "_No description provided._", "", `**Default branch**: ${repository.default_branch}`];

  if (repository.language) lines.push(`**Language**: ${repository.language}`);
  lines.push(
    `**Stars**: ${repository.stargazers_count} · **Forks**: ${repository.forks_count} · **Open issues**: ${repository.open_issues_count}`,
  );
  if (repository.topics?.length) lines.push(`**Topics**: ${repository.topics.join(", ")}`);
  if (repository.license?.spdx_id && repository.license.spdx_id !== "NOASSERTION") {
    lines.push(`**License**: ${repository.license.spdx_id}`);
  }
  const homepage = repository.homepage?.trim();
  if (homepage) lines.push(`**Homepage**: ${homepage}`);
  const visibility = [repository.private ? "private" : "public"];
  if (repository.archived) visibility.push("archived");
  if (repository.fork) visibility.push("fork");
  lines.push(
    `**Visibility**: ${visibility.join(", ")}`,
    `**Created**: ${repository.created_at} · **Last push**: ${repository.pushed_at}`,
    "",
    "_No README found._",
  );

  const metadata: FetchMetadata = {
    domain: "github.com",
    site: repository.full_name,
    ...(description ? { description } : {}),
    published: repository.created_at,
    status: document.status,
    ...(document.contentType ? { content_type: document.contentType } : {}),
    final_url: document.requestedUrl,
  };

  return {
    title: repository.full_name,
    markdown: lines.join("\n"),
    metadata,
    extractor: "github",
  };
}

export function renderGitHubThread(
  requestedUrl: string,
  owner: string,
  repo: string,
  number: number,
  document: { status: number; contentType: string | null },
  thread: { kind: "issue"; data: GitHubIssue } | { kind: "pull"; data: GitHubPull },
  comments: GitHubComment[],
): ExtractResult {
  const state = thread.kind === "pull" && thread.data.merged ? "merged" : thread.data.state;
  const lines = [`**State**: ${state}`];

  if (thread.kind === "pull") {
    lines.push(`**Branches**: ${thread.data.head.ref} → ${thread.data.base.ref}`);
    if (
      typeof thread.data.additions === "number" &&
      typeof thread.data.deletions === "number" &&
      typeof thread.data.changed_files === "number"
    ) {
      lines.push(
        `**Changes**: +${thread.data.additions} −${thread.data.deletions} in ${thread.data.changed_files} files`,
      );
    }
  }

  lines.push(
    "",
    thread.data.body?.trim() ? thread.data.body : "_No description provided._",
    "",
    `## Comments (${comments.length})`,
  );
  for (const comment of comments) {
    lines.push("", `### ${comment.user.login} (${comment.created_at})`, "", comment.body);
  }

  const metadata: FetchMetadata = {
    author: thread.data.user.login,
    published: thread.data.created_at,
    domain: "github.com",
    site: `${owner}/${repo}`,
    comment_count: comments.length,
    status: document.status,
    ...(document.contentType ? { content_type: document.contentType } : {}),
    ...(thread.data.html_url !== requestedUrl ? { final_url: thread.data.html_url } : {}),
  };

  return {
    title: `#${number} ${thread.data.title}`,
    markdown: lines.join("\n"),
    metadata,
    extractor: "github",
  };
}
