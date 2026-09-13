import { describe, expect, test } from "vitest";
import { readConfig } from "../src/config.js";

describe("readConfig", () => {
  test("reads a trimmed BRAVE_API_KEY", () => {
    expect(readConfig({ BRAVE_API_KEY: "  key-123  " })).toEqual({ braveApiKey: "key-123" });
  });

  test("treats a missing or blank key as undefined", () => {
    expect(readConfig({})).toEqual({ braveApiKey: undefined });
    expect(readConfig({ BRAVE_API_KEY: "   " })).toEqual({ braveApiKey: undefined });
  });
});
