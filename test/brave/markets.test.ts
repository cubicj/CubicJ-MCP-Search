import { describe, expect, test } from "vitest";
import { COUNTRY_CODES, SEARCH_LANGUAGES } from "../../src/brave/markets.js";

describe("Brave markets", () => {
  test("exports 38 unique country codes including KR and ALL", () => {
    expect(COUNTRY_CODES).toHaveLength(38);
    expect(COUNTRY_CODES).toContain("KR");
    expect(COUNTRY_CODES).toContain("ALL");
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
  });

  test("exports 52 unique search languages including ko and en", () => {
    expect(SEARCH_LANGUAGES).toHaveLength(52);
    expect(SEARCH_LANGUAGES).toContain("ko");
    expect(SEARCH_LANGUAGES).toContain("en");
    expect(new Set(SEARCH_LANGUAGES).size).toBe(SEARCH_LANGUAGES.length);
  });
});
