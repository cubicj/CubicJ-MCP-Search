import { genericExtractor } from "../generic.js";
import type { Extractor, FetchMetadata } from "../types.js";
import {
  fetchGitHubComments,
  fetchGitHubGist,
  fetchGitHubGistFile,
  fetchGitHubIssue,
  fetchGitHubPull,
  fetchGitHubRaw,
  fetchGitHubReadme,
  fetchGitHubRepository,
} from "./client.js";
import {
  parseGitHubUrl,
  renderGitHubFile,
  renderGitHubGist,
  renderGitHubRepository,
  renderGitHubThread,
} from "./parse.js";

function apiReadmeUrl(owner: string, repo: string): string {
  return `https://api.github.com/repos/${owner}/${repo}/readme`;
}

function documentMetadata(
  owner: string,
  repo: string,
  status: number,
  contentType: string | null,
  finalUrl: string,
): FetchMetadata {
  return {
    domain: "github.com",
    site: `${owner}/${repo}`,
    status,
    ...(contentType ? { content_type: contentType } : {}),
    final_url: finalUrl,
  };
}

export { parseGitHubUrl } from "./parse.js";

export const githubExtractor: Extractor = {
  name: "github",
  matches: (url) => parseGitHubUrl(url) !== null,
  async extract(url) {
    const parsed = parseGitHubUrl(new URL(url));
    if (!parsed) throw new Error(`Not a GitHub content URL: ${url}`);

    if (parsed.kind === "gist") {
      const { document, data } = await fetchGitHubGist(parsed.id);
      const entries = await Promise.all(
        Object.values(data.files).map(async (file) => {
          if (!file.truncated) return [file.filename, file.content] as const;
          const rawDocument = await fetchGitHubGistFile(file.raw_url);
          if (rawDocument.status < 200 || rawDocument.status >= 300) {
            throw new Error(`GitHub raw HTTP ${rawDocument.status}: ${rawDocument.requestedUrl}`);
          }
          return [file.filename, rawDocument.text] as const;
        }),
      );
      return renderGitHubGist(document, data, Object.fromEntries(entries));
    }

    if (parsed.kind === "file") {
      const document = await fetchGitHubRaw(parsed.owner, parsed.repo, parsed.ref, parsed.path);
      if (document.status < 200 || document.status >= 300) {
        throw new Error(`GitHub raw HTTP ${document.status}: ${document.requestedUrl}`);
      }
      return {
        title: parsed.path,
        markdown: renderGitHubFile(parsed.path, document.text),
        metadata: documentMetadata(
          parsed.owner,
          parsed.repo,
          document.status,
          document.contentType,
          document.requestedUrl,
        ),
        extractor: "github",
      };
    }

    if (parsed.kind === "repo") {
      const document = await fetchGitHubReadme(parsed.owner, parsed.repo);
      if (document.status >= 200 && document.status < 300) {
        const targetUrl = apiReadmeUrl(parsed.owner, parsed.repo);
        return {
          title: `${parsed.owner}/${parsed.repo}`,
          markdown: document.text,
          metadata: documentMetadata(parsed.owner, parsed.repo, document.status, document.contentType, targetUrl),
          extractor: "github",
        };
      }
      const repository = await fetchGitHubRepository(parsed.owner, parsed.repo);
      if (repository.data) return renderGitHubRepository(repository.document, repository.data);
      return genericExtractor.extract(url);
    }

    if (parsed.kind === "issue") {
      const { document, data } = await fetchGitHubIssue(parsed.owner, parsed.repo, parsed.number);
      const comments = await fetchGitHubComments(parsed.owner, parsed.repo, parsed.number);
      return renderGitHubThread(
        url,
        parsed.owner,
        parsed.repo,
        parsed.number,
        document,
        { kind: "issue", data },
        comments,
      );
    }

    const { document, data } = await fetchGitHubPull(parsed.owner, parsed.repo, parsed.number);
    const comments = await fetchGitHubComments(parsed.owner, parsed.repo, parsed.number);
    return renderGitHubThread(
      url,
      parsed.owner,
      parsed.repo,
      parsed.number,
      document,
      { kind: "pull", data },
      comments,
    );
  },
};
