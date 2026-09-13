# CubicJ MCP Search

Stateless Streamable HTTP MCP server with two read-only tools for LLM clients:

| Tool | What it does |
| --- | --- |
| `web_search` | Brave LLM Context search: relevance-ranked page excerpts per source URL, with `count`, `max_tokens`, `freshness`, `country`, and `search_lang` controls |
| `fetch` | Readable extraction of one URL as markdown (Defuddle), with site extractors for DCInside, Naver Blog, Bluesky, GitHub, Clien, Ruliweb, FMKorea, and namu.wiki, PDF text, raw mode, and pagination |

It replaces the separate `brave-search-api-mcp`, `dc-mcp-search`, and `defuddle-fetch-mcp` servers with one deployment sized by measured usage.

## Requirements

- Node.js 24, npm 11
- `BRAVE_API_KEY` (Brave Search API, Search plan) for `web_search`
- Optional `GITHUB_TOKEN` for higher GitHub API limits in `fetch`

## Run

```bash
npm ci
npm run build
BRAVE_API_KEY=... node dist/index.js --transport http --port 8006
curl -s http://127.0.0.1:8006/health
```

Without `--transport http` (or `--port`) the server speaks MCP over stdio. `PORT` sets the HTTP port when `--port` is absent; `.env.example` lists the variables for a systemd `EnvironmentFile`.

The HTTP endpoint is `POST /mcp`. Requests carrying a browser `Origin` header are rejected, bodies are capped at 1 MiB, and one log line per request goes to stderr. Put authentication in front of it (a reverse proxy or an OAuth gateway); the server has none.

## Development

```bash
npm test            # builds, then runs Vitest offline
npm run typecheck
npm run lint        # Biome
npm run smoke -- "query"   # live web_search, needs BRAVE_API_KEY exported
```

## License

MIT
