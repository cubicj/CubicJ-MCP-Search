import { STATUS_CODES } from "node:http";
import { type FetchedDocument, fetchDocument } from "../../fetch.js";

const API_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

const README_HEADERS = {
  Accept: "application/vnd.github.raw+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

function requestHeaders(baseHeaders?: Record<string, string>): Record<string, string> | undefined {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return baseHeaders;
  return { ...baseHeaders, Authorization: `Bearer ${token}` };
}

export interface GitHubUser {
  login: string;
}

export interface GitHubIssue {
  title: string;
  body: string | null;
  state: string;
  user: GitHubUser;
  created_at: string;
  html_url: string;
  comments: number;
}

export interface GitHubPull extends GitHubIssue {
  merged: boolean;
  merged_at: string | null;
  base: { ref: string };
  head: { ref: string };
  additions: number;
  deletions: number;
  changed_files: number;
}

export interface GitHubComment {
  user: GitHubUser;
  created_at: string;
  body: string;
}

export interface GitHubRepository {
  full_name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  topics?: string[];
  license: { spdx_id: string | null } | null;
  private: boolean;
  archived: boolean;
  fork: boolean;
  created_at: string;
  pushed_at: string;
}

export interface GitHubGistFile {
  filename: string;
  language: string | null;
  raw_url: string;
  truncated: boolean;
  content: string;
}

export interface GitHubGist {
  id: string;
  description: string | null;
  html_url: string;
  created_at: string;
  owner?: GitHubUser;
  files: Record<string, GitHubGistFile>;
}

export interface GitHubApiResult<T> {
  document: FetchedDocument;
  data: T;
}

function apiUrl(owner: string, repo: string, path?: string): string {
  const repositoryUrl = `https://api.github.com/repos/${owner}/${repo}`;
  return path ? `${repositoryUrl}/${path}` : repositoryUrl;
}

function errorMessage(document: FetchedDocument): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(document.text);
  } catch {
    return STATUS_CODES[document.status] ?? String(document.status);
  }
  if (typeof parsed === "object" && parsed !== null && "message" in parsed && typeof parsed.message === "string") {
    return parsed.message;
  }
  return STATUS_CODES[document.status] ?? String(document.status);
}

function requireSuccess(document: FetchedDocument): void {
  if (document.status < 200 || document.status >= 300) {
    throw new Error(`GitHub API HTTP ${document.status}: ${errorMessage(document)}`);
  }
}

function fetchJsonDocument(url: string): Promise<FetchedDocument> {
  return fetchDocument(url, { headers: requestHeaders(API_HEADERS) });
}

async function fetchJson<T>(url: string): Promise<GitHubApiResult<T>> {
  const document = await fetchJsonDocument(url);
  requireSuccess(document);
  return { document, data: JSON.parse(document.text) as T };
}

export function fetchGitHubReadme(owner: string, repo: string): Promise<FetchedDocument> {
  return fetchDocument(apiUrl(owner, repo, "readme"), { headers: requestHeaders(README_HEADERS) });
}

export async function fetchGitHubRepository(
  owner: string,
  repo: string,
): Promise<GitHubApiResult<GitHubRepository | null>> {
  const document = await fetchJsonDocument(apiUrl(owner, repo));
  const data = document.status >= 200 && document.status < 300 ? (JSON.parse(document.text) as GitHubRepository) : null;
  return { document, data };
}

export function fetchGitHubRaw(owner: string, repo: string, ref: string, path: string): Promise<FetchedDocument> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
  const headers = requestHeaders();
  return headers ? fetchDocument(url, { headers }) : fetchDocument(url);
}

export function fetchGitHubGist(id: string): Promise<GitHubApiResult<GitHubGist>> {
  return fetchJson<GitHubGist>(`https://api.github.com/gists/${id}`);
}

export function fetchGitHubGistFile(rawUrl: string): Promise<FetchedDocument> {
  const headers = requestHeaders();
  return headers ? fetchDocument(rawUrl, { headers }) : fetchDocument(rawUrl);
}

export function fetchGitHubIssue(owner: string, repo: string, number: number): Promise<GitHubApiResult<GitHubIssue>> {
  return fetchJson<GitHubIssue>(apiUrl(owner, repo, `issues/${number}`));
}

export function fetchGitHubPull(owner: string, repo: string, number: number): Promise<GitHubApiResult<GitHubPull>> {
  return fetchJson<GitHubPull>(apiUrl(owner, repo, `pulls/${number}`));
}

export async function fetchGitHubComments(owner: string, repo: string, number: number): Promise<GitHubComment[]> {
  const comments: GitHubComment[] = [];
  let page = 1;

  while (true) {
    const url = `${apiUrl(owner, repo, `issues/${number}/comments`)}?per_page=100&page=${page}`;
    const result = await fetchJson<GitHubComment[]>(url);
    if (!Array.isArray(result.data)) throw new Error("GitHub API returned an invalid comments response");
    comments.push(...result.data);
    if (result.data.length < 100) return comments;
    page++;
  }
}
