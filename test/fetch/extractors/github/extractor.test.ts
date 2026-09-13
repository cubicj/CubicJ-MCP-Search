import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test, vi } from "vitest";
import {
  fetchGitHubGist,
  fetchGitHubGistFile,
  type GitHubGist,
} from "../../../../src/fetch/extractors/github/client.js";
import { githubExtractor, parseGitHubUrl } from "../../../../src/fetch/extractors/github/extractor.js";
import { renderGitHubGist } from "../../../../src/fetch/extractors/github/parse.js";
import { type FetchedDocument, fetchDocument } from "../../../../src/fetch/fetch.js";

vi.mock("../../../../src/fetch/fetch.js", () => ({
  fetchDocument: vi.fn(),
}));

vi.mock("../../../../src/fetch/extractors/github/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/fetch/extractors/github/client.js")>()),
  fetchGitHubGist: vi.fn(),
  fetchGitHubGistFile: vi.fn(),
}));

const mockedFetchDocument = vi.mocked(fetchDocument);
const mockedFetchGitHubGist = vi.mocked(fetchGitHubGist);
const mockedFetchGitHubGistFile = vi.mocked(fetchGitHubGistFile);

function fixture(name: string): GitHubGist {
  return JSON.parse(readFileSync(new URL(`../../fixtures/github/${name}`, import.meta.url), "utf8")) as GitHubGist;
}

function fetchedDocument(
  url: string,
  text: string,
  status = 200,
  contentType: string | null = "application/json",
): FetchedDocument {
  return {
    requestedUrl: url,
    finalUrl: url,
    status,
    statusText: status === 200 ? "OK" : "",
    contentType,
    bytes: new TextEncoder().encode(text),
    text,
  };
}

function issueComment(index: number) {
  return {
    user: { login: `commenter-${index}` },
    created_at: `2026-08-22T00:${String(index % 60).padStart(2, "0")}:00Z`,
    body: `Comment ${index}`,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("parseGitHubUrl recognizes files, repositories, issues, and pulls", () => {
  const cases = [
    [
      "https://github.com/openai/codex/blob/main/src/extractors/github/file.ts",
      { kind: "file", owner: "openai", repo: "codex", ref: "main", path: "src/extractors/github/file.ts" },
    ],
    [
      "https://www.github.com/cubicj/project/raw/v1/docs/README.md",
      { kind: "file", owner: "cubicj", repo: "project", ref: "v1", path: "docs/README.md" },
    ],
    ["https://www.github.com/openai/codex/", { kind: "repo", owner: "openai", repo: "codex" }],
    ["https://github.com/openai/codex/issues/42", { kind: "issue", owner: "openai", repo: "codex", number: 42 }],
    ["https://github.com/openai/codex/pull/7", { kind: "pull", owner: "openai", repo: "codex", number: 7 }],
  ] as const;

  for (const [url, expected] of cases) {
    assert.deepEqual(parseGitHubUrl(new URL(url)), expected, url);
  }
});

test("parses gist URLs", () => {
  assert.deepEqual(parseGitHubUrl(new URL("https://gist.github.com/kepano/0123456789abcdef0123456789abcdef")), {
    kind: "gist",
    id: "0123456789abcdef0123456789abcdef",
  });
  assert.deepEqual(parseGitHubUrl(new URL("https://gist.github.com/0123456789abcdef0123456789abcdef")), {
    kind: "gist",
    id: "0123456789abcdef0123456789abcdef",
  });
  assert.equal(parseGitHubUrl(new URL("https://gist.github.com/")), null);
  assert.equal(parseGitHubUrl(new URL("https://gist.github.com/discover")), null);
});

test("renders a gist with one section per file", () => {
  const gist = fixture("gist.json");
  const contents = Object.fromEntries(Object.values(gist.files).map((file) => [file.filename, file.content]));
  const result = renderGitHubGist(
    { requestedUrl: gist.html_url, status: 200, contentType: "application/json" },
    gist,
    contents,
  );
  assert.equal(result.extractor, "github");
  assert.equal(result.title, gist.description);
  for (const file of Object.values(gist.files)) {
    assert.match(result.markdown, new RegExp(`\\n## ${file.filename.replace(/\\./g, "\\\\.")}\\n`));
  }
  assert.equal(result.metadata.domain, "gist.github.com");
  assert.equal(result.metadata.author, gist.owner?.login);
});

test("githubExtractor fetches full content for truncated gist files", async () => {
  const gist = fixture("gist.json");
  const truncatedFile = Object.values(gist.files)[0];
  truncatedFile.truncated = true;
  truncatedFile.content = "Truncated content";
  const apiUrl = `https://api.github.com/gists/${gist.id}`;
  const document = fetchedDocument(apiUrl, JSON.stringify(gist));
  mockedFetchGitHubGist.mockResolvedValue({ document, data: gist });
  mockedFetchGitHubGistFile.mockResolvedValue(
    fetchedDocument(truncatedFile.raw_url, "Complete raw gist content", 200, "text/plain"),
  );

  const result = await githubExtractor.extract(gist.html_url);

  assert.deepEqual(mockedFetchGitHubGist.mock.calls, [[gist.id]]);
  assert.deepEqual(mockedFetchGitHubGistFile.mock.calls, [[truncatedFile.raw_url]]);
  assert.match(result.markdown, /Complete raw gist content/);
  assert.doesNotMatch(result.markdown, /Truncated content/);
});

test("parseGitHubUrl rejects unsupported and non-GitHub URLs", () => {
  const urls = [
    "https://github.com/openai",
    "https://github.com/openai/codex/tree/main",
    "https://github.com/openai/codex/releases",
    "https://github.com/openai/codex/pull/abc",
    "https://github.com/explore/topics",
    "https://github.com/settings/profile",
    "https://gitlab.com/openai/codex",
  ];

  for (const url of urls) {
    assert.equal(parseGitHubUrl(new URL(url)), null, url);
  }
});

test("githubExtractor returns markdown files unchanged and fences source files with the extension", async () => {
  const markdownUrl = "https://github.com/cubicj/project/blob/main/docs/README.MD";
  const markdownRawUrl = "https://raw.githubusercontent.com/cubicj/project/main/docs/README.MD";
  const sourceUrl = "https://github.com/cubicj/project/raw/main/src/index.TS";
  const sourceRawUrl = "https://raw.githubusercontent.com/cubicj/project/main/src/index.TS";
  mockedFetchDocument.mockImplementation(async (url) => {
    if (url === markdownRawUrl) return fetchedDocument(url, "# Project\n", 200, "text/plain");
    if (url === sourceRawUrl) return fetchedDocument(url, 'const fence = "```";', 200, "text/plain");
    throw new Error(`Unexpected URL: ${url}`);
  });

  const markdown = await githubExtractor.extract(markdownUrl);
  const source = await githubExtractor.extract(sourceUrl);

  assert.equal(markdown.title, "docs/README.MD");
  assert.equal(markdown.markdown, "# Project\n");
  assert.equal(markdown.extractor, "github");
  assert.deepEqual(markdown.metadata, {
    domain: "github.com",
    site: "cubicj/project",
    status: 200,
    content_type: "text/plain",
    final_url: markdownRawUrl,
  });
  assert.equal(source.markdown, '````ts\nconst fence = "```";\n````');
  assert.equal(source.extractor, "github");
});

test("githubExtractor reads repository README content through the GitHub API", async () => {
  const url = "https://github.com/cubicj/project";
  const apiUrl = "https://api.github.com/repos/cubicj/project/readme";
  mockedFetchDocument.mockResolvedValue(fetchedDocument(apiUrl, "# Project README\n", 200, "text/plain"));

  const result = await githubExtractor.extract(url);

  assert.equal(result.title, "cubicj/project");
  assert.equal(result.markdown, "# Project README\n");
  assert.equal(result.extractor, "github");
  assert.deepEqual(result.metadata, {
    domain: "github.com",
    site: "cubicj/project",
    status: 200,
    content_type: "text/plain",
    final_url: apiUrl,
  });
  assert.deepEqual(mockedFetchDocument.mock.calls[0], [
    apiUrl,
    {
      headers: {
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  ]);
});

test("githubExtractor authenticates GitHub API requests when GITHUB_TOKEN is set", async () => {
  vi.stubEnv("GITHUB_TOKEN", " github-token ");
  const url = "https://github.com/cubicj/project";
  const apiUrl = "https://api.github.com/repos/cubicj/project/readme";
  mockedFetchDocument.mockResolvedValue(fetchedDocument(apiUrl, "# Project README\n", 200, "text/plain"));

  await githubExtractor.extract(url);

  assert.deepEqual(mockedFetchDocument.mock.calls[0], [
    apiUrl,
    {
      headers: {
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: "Bearer github-token",
      },
    },
  ]);
});

test("githubExtractor authenticates raw file requests when GITHUB_TOKEN is set", async () => {
  vi.stubEnv("GITHUB_TOKEN", "github-token");
  const url = "https://github.com/cubicj/project/blob/main/README.md";
  const rawUrl = "https://raw.githubusercontent.com/cubicj/project/main/README.md";
  mockedFetchDocument.mockResolvedValue(fetchedDocument(rawUrl, "# Project\n", 200, "text/plain"));

  await githubExtractor.extract(url);

  assert.deepEqual(mockedFetchDocument.mock.calls[0], [rawUrl, { headers: { Authorization: "Bearer github-token" } }]);
});

test("githubExtractor omits Authorization when GITHUB_TOKEN is unset", async () => {
  vi.stubEnv("GITHUB_TOKEN", undefined);
  const url = "https://github.com/cubicj/project/blob/main/README.md";
  const rawUrl = "https://raw.githubusercontent.com/cubicj/project/main/README.md";
  mockedFetchDocument.mockResolvedValue(fetchedDocument(rawUrl, "# Project\n", 200, "text/plain"));

  await githubExtractor.extract(url);

  assert.deepEqual(mockedFetchDocument.mock.calls[0], [rawUrl]);
});

test("githubExtractor renders repository metadata when a README is unavailable", async () => {
  vi.stubEnv("GITHUB_TOKEN", "github-token");
  const url = "https://github.com/cubicj/project";
  const readmeApiUrl = "https://api.github.com/repos/cubicj/project/readme";
  const repositoryApiUrl = "https://api.github.com/repos/cubicj/project";
  const repository = {
    full_name: "cubicj/project",
    description: "A focused extraction server.",
    html_url: url,
    homepage: "",
    default_branch: "main",
    language: null,
    stargazers_count: 12,
    forks_count: 3,
    open_issues_count: 4,
    topics: ["mcp", "fetch"],
    license: { spdx_id: "NOASSERTION" },
    private: true,
    archived: true,
    fork: false,
    created_at: "2026-08-01T01:02:03Z",
    pushed_at: "2026-08-22T04:05:06Z",
  };
  mockedFetchDocument.mockImplementation(async (requestedUrl) => {
    if (requestedUrl === readmeApiUrl) return fetchedDocument(requestedUrl, '{"message":"Not Found"}', 404);
    if (requestedUrl === repositoryApiUrl) return fetchedDocument(requestedUrl, JSON.stringify(repository));
    throw new Error(`Unexpected URL: ${requestedUrl}`);
  });

  const result = await githubExtractor.extract(url);

  assert.equal(result.title, "cubicj/project");
  assert.equal(result.extractor, "github");
  assert.match(result.markdown, /^A focused extraction server\.$/m);
  assert.match(result.markdown, /^\*\*Default branch\*\*: main$/m);
  assert.match(result.markdown, /^\*\*Stars\*\*: 12 · \*\*Forks\*\*: 3 · \*\*Open issues\*\*: 4$/m);
  assert.match(result.markdown, /^\*\*Topics\*\*: mcp, fetch$/m);
  assert.match(result.markdown, /^\*\*Visibility\*\*: private, archived$/m);
  assert.match(result.markdown, /_No README found\._$/);
  assert.doesNotMatch(result.markdown, /^\*\*(?:Language|License|Homepage)\*\*:/m);
  assert.deepEqual(result.metadata, {
    domain: "github.com",
    site: "cubicj/project",
    description: "A focused extraction server.",
    published: "2026-08-01T01:02:03Z",
    status: 200,
    content_type: "application/json",
    final_url: repositoryApiUrl,
  });
  assert.deepEqual(
    mockedFetchDocument.mock.calls.map((call) => call[0]),
    [readmeApiUrl, repositoryApiUrl],
  );
  assert.deepEqual(mockedFetchDocument.mock.calls[1], [
    repositoryApiUrl,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: "Bearer github-token",
      },
    },
  ]);
});

test("githubExtractor falls back to generic extraction when repository APIs return not found", async () => {
  const url = "https://github.com/cubicj/project";
  const readmeApiUrl = "https://api.github.com/repos/cubicj/project/readme";
  const repositoryApiUrl = "https://api.github.com/repos/cubicj/project";
  const html =
    "<!doctype html><html><head><title>Fallback Repository</title></head><body><main><p>Repository overview.</p></main></body></html>";
  mockedFetchDocument.mockImplementation(async (requestedUrl) => {
    if (requestedUrl === readmeApiUrl || requestedUrl === repositoryApiUrl) {
      return fetchedDocument(requestedUrl, '{"message":"Not Found"}', 404);
    }
    if (requestedUrl === url) return fetchedDocument(url, html, 200, "text/html");
    throw new Error(`Unexpected URL: ${requestedUrl}`);
  });

  const result = await githubExtractor.extract(url);

  assert.equal(result.extractor, "defuddle");
  assert.equal(result.title, "Fallback Repository");
  assert.match(result.markdown, /Repository overview\./);
  assert.deepEqual(
    mockedFetchDocument.mock.calls.map((call) => call[0]),
    [readmeApiUrl, repositoryApiUrl, url],
  );
});

test("githubExtractor reads an issue and all comment pages in order", async () => {
  const url = "https://github.com/cubicj/project/issues/42";
  const issueApiUrl = "https://api.github.com/repos/cubicj/project/issues/42";
  const pageOneUrl = `${issueApiUrl}/comments?per_page=100&page=1`;
  const pageTwoUrl = `${issueApiUrl}/comments?per_page=100&page=2`;
  const pageOne = Array.from({ length: 100 }, (_, index) => issueComment(index + 1));
  const pageTwo = Array.from({ length: 3 }, (_, index) => issueComment(index + 101));
  const issue = {
    title: "Issue title",
    body: null,
    state: "open",
    user: { login: "issue-author" },
    created_at: "2026-08-20T01:02:03Z",
    html_url: url,
    comments: 103,
  };
  mockedFetchDocument.mockImplementation(async (requestedUrl) => {
    if (requestedUrl === issueApiUrl) return fetchedDocument(requestedUrl, JSON.stringify(issue));
    if (requestedUrl === pageOneUrl) return fetchedDocument(requestedUrl, JSON.stringify(pageOne));
    if (requestedUrl === pageTwoUrl) return fetchedDocument(requestedUrl, JSON.stringify(pageTwo));
    throw new Error(`Unexpected URL: ${requestedUrl}`);
  });

  const result = await githubExtractor.extract(url);

  assert.equal(result.title, "#42 Issue title");
  assert.equal(result.extractor, "github");
  assert.equal(result.metadata.comment_count, 103);
  assert.equal(result.metadata.author, "issue-author");
  assert.equal(result.metadata.published, "2026-08-20T01:02:03Z");
  assert.equal(result.metadata.status, 200);
  assert.equal(result.metadata.content_type, "application/json");
  assert.equal(result.metadata.final_url, undefined);
  assert.match(result.markdown, /^\*\*State\*\*: open/);
  assert.match(result.markdown, /_No description provided\._/);
  assert.match(result.markdown, /## Comments \(103\)/);
  assert.match(result.markdown, /### commenter-103 \(2026-08-22T00:43:00Z\)\n\nComment 103$/);
  assert.deepEqual(
    mockedFetchDocument.mock.calls.map((call) => call[0]),
    [issueApiUrl, pageOneUrl, pageTwoUrl],
  );
});

test("githubExtractor renders merged pull request state, branches, and changes", async () => {
  const url = "https://github.com/cubicj/project/pull/7";
  const pullApiUrl = "https://api.github.com/repos/cubicj/project/pulls/7";
  const commentsUrl = "https://api.github.com/repos/cubicj/project/issues/7/comments?per_page=100&page=1";
  const pull = {
    title: "Ship GitHub extraction",
    body: "Pull request body.",
    state: "closed",
    user: { login: "pull-author" },
    created_at: "2026-08-21T01:02:03Z",
    html_url: url,
    comments: 0,
    merged: true,
    merged_at: "2026-08-22T01:02:03Z",
    base: { ref: "main" },
    head: { ref: "feature/github" },
    additions: 120,
    deletions: 8,
    changed_files: 4,
  };
  mockedFetchDocument.mockImplementation(async (requestedUrl) => {
    if (requestedUrl === pullApiUrl) return fetchedDocument(requestedUrl, JSON.stringify(pull));
    if (requestedUrl === commentsUrl) return fetchedDocument(requestedUrl, "[]");
    throw new Error(`Unexpected URL: ${requestedUrl}`);
  });

  const result = await githubExtractor.extract(url);

  assert.equal(result.extractor, "github");
  assert.match(result.markdown, /^\*\*State\*\*: merged$/m);
  assert.match(result.markdown, /^\*\*Branches\*\*: feature\/github → main$/m);
  assert.match(result.markdown, /^\*\*Changes\*\*: \+120 −8 in 4 files$/m);
  assert.match(result.markdown, /## Comments \(0\)$/);
});

test("githubExtractor propagates GitHub API error messages without exposing the token", async () => {
  vi.stubEnv("GITHUB_TOKEN", "secret-token");
  const url = "https://github.com/cubicj/project/issues/42";
  const apiUrl = "https://api.github.com/repos/cubicj/project/issues/42";
  mockedFetchDocument.mockResolvedValue(fetchedDocument(apiUrl, '{"message":"Bad credentials"}', 401));

  await assert.rejects(githubExtractor.extract(url), {
    message: "GitHub API HTTP 401: Bad credentials",
  });
});
