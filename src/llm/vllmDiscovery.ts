export type VllmDiscoveryResult =
  | { ok: true; models: string[] }
  | { ok: false; error: string };

export type VllmDiscoveryOptions = {
  fetchImpl?: typeof fetch;
};

export function resolveVllmModelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

export async function discoverVllmModels(
  baseUrl: string,
  options: VllmDiscoveryOptions = {}
): Promise<VllmDiscoveryResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(resolveVllmModelsUrl(baseUrl), {
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      return { ok: false, error: `vLLM returned HTTP ${response.status}` };
    }
    const json = await response.json() as { data?: Array<{ id?: unknown }> };
    const models = (json.data ?? [])
      .map((entry) => typeof entry.id === "string" ? entry.id.trim() : "")
      .filter((id) => id.length > 0);
    if (models.length === 0) {
      return { ok: false, error: "No vLLM models found." };
    }
    return { ok: true, models };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
