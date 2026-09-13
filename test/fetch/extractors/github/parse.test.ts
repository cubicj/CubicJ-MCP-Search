import assert from "node:assert/strict";
import { test } from "vitest";
import { parseGitHubUrl } from "../../../../src/fetch/extractors/github/parse.js";

test("parses legacy short gist IDs and rejects non-hex paths", () => {
  assert.deepEqual(parseGitHubUrl(new URL("https://gist.github.com/defunkt/1078")), {
    kind: "gist",
    id: "1078",
  });
  assert.equal(parseGitHubUrl(new URL("https://gist.github.com/discover")), null);
});
