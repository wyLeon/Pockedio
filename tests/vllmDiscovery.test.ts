import { describe, expect, it } from "vitest";
import { discoverVllmModels, resolveVllmModelsUrl } from "../src/llm/vllmDiscovery.js";

describe("vLLM model discovery", () => {
  it("resolves the OpenAI-compatible models endpoint from a /v1 base URL", () => {
    expect(resolveVllmModelsUrl("http://127.0.0.1:8000/v1")).toBe("http://127.0.0.1:8000/v1/models");
    expect(resolveVllmModelsUrl("http://127.0.0.1:8000/v1/")).toBe("http://127.0.0.1:8000/v1/models");
  });

  it("discovers model ids from a vLLM /models response", async () => {
    const result = await discoverVllmModels("http://127.0.0.1:8000/v1", {
      fetchImpl: async (url) => {
        expect(String(url)).toBe("http://127.0.0.1:8000/v1/models");
        return new Response(JSON.stringify({
          data: [
            { id: "Qwen/Qwen3-8B" },
            { id: "meta-llama/Llama-3.1-8B-Instruct" }
          ]
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    expect(result).toEqual({
      ok: true,
      models: ["Qwen/Qwen3-8B", "meta-llama/Llama-3.1-8B-Instruct"]
    });
  });

  it("returns a stable failure when the server is unavailable", async () => {
    const result = await discoverVllmModels("http://127.0.0.1:8000/v1", {
      fetchImpl: async () => {
        throw new Error("offline");
      }
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("offline");
  });
});
