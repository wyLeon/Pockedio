export type LlmUnavailableCode = "llm_unavailable";

export type LlmResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      errorCode: LlmUnavailableCode | "llm_error" | "invalid_json";
      error: string;
    };

export type LlmRequestOptions = {
  signal?: AbortSignal;
};

export type LlmClient = {
  generateJson<T = unknown>(prompt: string, schemaDescription: string, options?: LlmRequestOptions): Promise<LlmResult<T>>;
  generateText(prompt: string, options?: LlmRequestOptions): Promise<LlmResult<string>>;
};

export class UnavailableLlmClient implements LlmClient {
  constructor(private readonly apiKeyEnv = "OPENAI_API_KEY") {}

  async generateJson<T = unknown>(): Promise<LlmResult<T>> {
    return {
      ok: false,
      errorCode: "llm_unavailable",
      error: `${this.apiKeyEnv} is not configured.`
    };
  }

  async generateText(): Promise<LlmResult<string>> {
    return {
      ok: false,
      errorCode: "llm_unavailable",
      error: `${this.apiKeyEnv} is not configured.`
    };
  }
}
