#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createBraveClient } from "./brave/client.js";
import { readConfig } from "./config.js";
import { startHttpServer } from "./http.js";
import { createMcpServer, type ServerDeps } from "./server.js";

const DEFAULT_PORT = 8006;

export function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid port: ${value}`);
  return port;
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): { isHttp: boolean; port: number } {
  const transportIdx = argv.indexOf("--transport");
  const portIdx = argv.indexOf("--port");
  const isHttp = (transportIdx !== -1 && argv[transportIdx + 1] === "http") || portIdx !== -1;
  const port = parsePort(portIdx !== -1 ? argv[portIdx + 1] : env.PORT);
  return { isHttp, port };
}

function buildDeps(env: NodeJS.ProcessEnv): ServerDeps {
  const { braveApiKey } = readConfig(env);
  if (!braveApiKey) {
    console.error("BRAVE_API_KEY is not set; web_search will return a configuration error until it is");
    return {};
  }
  return { braveClient: createBraveClient({ apiKey: braveApiKey }) };
}

async function main(): Promise<void> {
  const { isHttp, port } = parseArgs(process.argv.slice(2), process.env);
  const deps = buildDeps(process.env);

  if (isHttp) {
    startHttpServer(port, deps);
    return;
  }

  serveStdio(() => createMcpServer(deps));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
