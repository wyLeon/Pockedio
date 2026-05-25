import type { LlmClient } from "../llm/llmClient.js";
import { MemoryStore, type MessageRecord } from "./store.js";

export type SessionSummaryResult = {
  summary: string;
  messageCount: number;
  summaryId?: string;
};

export type SessionSummaryDraft = {
  summary: string;
  durable: boolean;
  metadata?: Record<string, unknown>;
};

type ExtractedSessionMemory = {
  durable?: boolean;
  summary?: string;
  musicTags?: unknown;
  contextTags?: unknown;
  avoidTags?: unknown;
  useCases?: unknown;
  confidence?: unknown;
};

const memoryUpdatePattern = /\b(summarize this session|update memory|save this memory|refresh memory|session memory)\b/i;
const requestPattern = /\b(play|listen|hear|queue|station|recommend|suggest|dj program|dj version|music)\b/i;
const durableContextPattern = /\b(morning|evening|night|late night|reading|writing|work|study|focus|deep work|commute|travel|recovery|decompress|workout|meditation|sleep|rainy|winter|summer|weekend|meeting|calendar|diary|usually|always|often|remember|save this|for when)\b/i;
const tastePattern = /\b(i like|i love|i prefer|i realized|reminds me|this reminds|my taste|for reading|for focus|helps me|distracts me|too bright|too sharp|too busy|too loud|too sleepy|spacious|instrumental|vocals?|calm|relax|deep work|meditation|morning|evening)\b/i;
const feedbackPattern = /\b(more like this|less like this|favorite this|save this|save this vibe|remember this vibe|never play|ban|skip this|change the vibe|different vibe|good pick|nice pick|love this|like this)\b/i;

export function summarizeSession(store: MemoryStore, sessionId: string): SessionSummaryResult {
  const messages = store.getSessionMessages(sessionId);
  const draft = buildDeterministicSessionSummary({ messages });
  return storeSessionSummaryDraft(store, sessionId, messages.length, draft);
}

export async function summarizeSessionWithLlm(store: MemoryStore, sessionId: string, llm: LlmClient, signal?: AbortSignal): Promise<SessionSummaryResult> {
  const messages = store.getSessionMessages(sessionId);
  if (signal?.aborted) {
    return storeSessionSummaryDraft(store, sessionId, messages.length, buildDeterministicSessionSummary({ messages }));
  }
  const extracted = await extractSessionMemoryWithLlm(messages, llm, signal);
  const draft = extracted ?? buildDeterministicSessionSummary({ messages });
  return storeSessionSummaryDraft(store, sessionId, messages.length, draft);
}

function storeSessionSummaryDraft(store: MemoryStore, sessionId: string, messageCount: number, draft: SessionSummaryDraft): SessionSummaryResult {
  const result: SessionSummaryResult = {
    summary: draft.summary,
    messageCount
  };

  if (!draft.durable) {
    return result;
  }

  result.summaryId = store.addSessionSummary(sessionId, draft.summary, {
    generatedBy: draft.metadata?.generatedBy ?? "deterministic_session_summary",
    messageCount,
    ...(draft.metadata ?? {})
  });
  return result;
}

export function buildDeterministicSessionSummary(input: { messages: MessageRecord[] }): SessionSummaryDraft {
  const userMessages = input.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter((content) => content && !memoryUpdatePattern.test(content));
  const requests = uniqueLimited(userMessages.filter((content) => requestPattern.test(content)), 3);
  const tasteSignals = uniqueLimited(userMessages.filter((content) => tastePattern.test(content)), 4);
  const feedbackSignals = uniqueLimited(userMessages.filter((content) => feedbackPattern.test(content)), 4);
  const contextSignals = uniqueLimited(userMessages.filter((content) => durableContextPattern.test(content) && !tastePattern.test(content) && !feedbackPattern.test(content)), 3);
  const durable = tasteSignals.length > 0 || feedbackSignals.length > 0 || contextSignals.length > 0;

  const lines = ["Session memory summary:"];
  if (durable && requests.length > 0) {
    lines.push(`- User requests: ${requests.join(" | ")}`);
  }
  if (tasteSignals.length > 0) {
    lines.push(`- Listening/taste signals: ${tasteSignals.join(" | ")}`);
  }
  if (feedbackSignals.length > 0) {
    lines.push(`- Feedback/control signals: ${feedbackSignals.join(" | ")}`);
  }
  if (contextSignals.length > 0) {
    lines.push(`- Durable context signals: ${contextSignals.join(" | ")}`);
  }
  if (lines.length === 1) {
    lines.push("- No durable preference signals found.");
  }

  return {
    summary: lines.join("\n"),
    durable,
    metadata: durable ? {
      source: "session",
      confidence: "low"
    } : undefined
  };
}

async function extractSessionMemoryWithLlm(messages: MessageRecord[], llm: LlmClient, signal?: AbortSignal): Promise<SessionSummaryDraft | null> {
  const userMessages = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .slice(-12);
  if (userMessages.length === 0) {
    return null;
  }

  const prompt = [
    "Extract reusable DJ memory from this Pockedio session.",
    "Return JSON with durable, summary, musicTags, contextTags, avoidTags, useCases, and confidence.",
    "Only mark durable=true for reusable listening preference, feedback, or context signals.",
    "Do not store generic playback requests. Do not quote private text beyond a compact summary.",
    "",
    userMessages.map((message) => `User: ${message}`).join("\n")
  ].join("\n");
  let result;
  try {
    result = await llm.generateJson<ExtractedSessionMemory>(prompt, "DJ session memory extraction JSON", { signal });
  } catch {
    return null;
  }
  if (!result.ok) {
    return null;
  }

  const value = result.value;
  const summary = typeof value.summary === "string" ? value.summary.trim() : "";
  if (!value.durable || !summary) {
    return {
      durable: false,
      summary: "Session memory summary:\n- No durable preference signals found."
    };
  }

  return {
    durable: true,
    summary: `Session memory summary:\n- ${summary}`,
    metadata: {
      generatedBy: "llm_session_memory_extractor",
      source: "session",
      musicTags: stringArray(value.musicTags).slice(0, 8),
      contextTags: stringArray(value.contextTags).slice(0, 8),
      avoidTags: stringArray(value.avoidTags).slice(0, 8),
      useCases: stringArray(value.useCases).slice(0, 6),
      confidence: normalizeConfidence(value.confidence)
    }
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function normalizeConfidence(value: unknown): "low" | "medium" | "high" {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function uniqueLimited(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(value);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}
