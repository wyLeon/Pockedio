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

export type LlmClient = {
  generateJson<T = unknown>(prompt: string, schemaDescription: string): Promise<LlmResult<T>>;
  generateText(prompt: string): Promise<LlmResult<string>>;
};

export class UnavailableLlmClient implements LlmClient {
  async generateJson<T = unknown>(): Promise<LlmResult<T>> {
    return {
      ok: false,
      errorCode: "llm_unavailable",
      error: "OPENAI_API_KEY is not configured."
    };
  }

  async generateText(): Promise<LlmResult<string>> {
    return {
      ok: false,
      errorCode: "llm_unavailable",
      error: "OPENAI_API_KEY is not configured."
    };
  }
}
