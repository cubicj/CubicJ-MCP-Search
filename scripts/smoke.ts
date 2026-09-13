import { createBraveClient } from "../src/brave/client.js";
import { readConfig } from "../src/config.js";
import { runWebSearch } from "../src/tools/web-search.js";

const { braveApiKey } = readConfig();
if (!braveApiKey) {
  console.error("BRAVE_API_KEY is not set; export it before running the smoke test");
  process.exit(1);
}

const query = process.argv.slice(2).join(" ") || "Brave Search API";
const result = await runWebSearch(createBraveClient({ apiKey: braveApiKey }), { query, count: 3, max_tokens: 2048 });
console.log(result.content[0]?.type === "text" ? result.content[0].text : JSON.stringify(result));
process.exitCode = result.isError ? 1 : 0;
