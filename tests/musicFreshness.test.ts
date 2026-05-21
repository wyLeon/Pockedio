import { describe, expect, it } from "vitest";
import { createWikidataMusicFreshnessProvider } from "../src/context/musicFreshness.js";

describe("Wikidata music freshness provider", () => {
  it("returns a sourced death-date fact for a matched artist entity", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("wbsearchentities")) {
        return jsonResponse({
          search: [{
            id: "Q123",
            label: "Khalil Fong",
            description: "Hong Kong singer-songwriter"
          }]
        });
      }
      if (url.includes("Special:EntityData/Q123.json")) {
        return jsonResponse({
          entities: {
            Q123: {
              labels: {
                en: { value: "Khalil Fong" },
                zh: { value: "方大同" }
              },
              claims: {
                P570: [{
                  mainsnak: {
                    datavalue: {
                      value: { time: "+2025-02-21T00:00:00Z" }
                    }
                  }
                }]
              }
            }
          }
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const provider = createWikidataMusicFreshnessProvider(fetchImpl);
    const result = await provider.lookup("Tell me recent updates from 方大同");

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].source).toBe("Wikidata");
    expect(result.sources[0].snippet).toContain("Khalil Fong");
    expect(result.sources[0].snippet).toContain("died on February 21, 2025");
  });
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body
  } as Response;
}
