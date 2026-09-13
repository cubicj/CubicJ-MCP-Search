import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "vitest";
import { fetchBlueskyJson } from "../../../../src/fetch/extractors/bluesky/client.js";

test("uses the HTTP status text for a non-JSON API error", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(502, { "Content-Type": "text/plain" });
    response.end("upstream failure");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind to a TCP port");

  try {
    await assert.rejects(
      fetchBlueskyJson(`http://127.0.0.1:${address.port}/xrpc`),
      new Error("Bluesky API error: 502 Bad Gateway"),
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
