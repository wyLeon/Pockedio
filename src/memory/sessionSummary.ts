import { MemoryStore, type MessageRecord } from "./store.js";

export type SessionSummaryResult = {
  summary: string;
  messageCount: number;
  summaryId?: string;
};

export type SessionSummaryDraft = {
  summary: string;
  durable: boolean;
};

const memoryUpdatePattern = /\b(summarize this session|update memory|save this memory|refresh memory|session memory)\b/i;
const requestPattern = /\b(play|listen|hear|queue|station|recommend|suggest|dj program|dj version|music)\b/i;
const durableContextPattern = /\b(morning|evening|night|late night|reading|writing|work|study|focus|deep work|commute|travel|recovery|decompress|workout|meditation|sleep|rainy|winter|summer|weekend|meeting|calendar|diary|usually|always|often|remember|save this|for when)\b/i;
const tastePattern = /\b(i like|i love|i prefer|i realized|reminds me|this reminds|my taste|for reading|for focus|helps me|distracts me|too bright|too sharp|too busy|too loud|too sleepy|spacious|instrumental|vocals?|calm|relax|deep work|meditation|morning|evening)\b/i;
const feedbackPattern = /\b(more like this|less like this|favorite this|save this|save this vibe|remember this vibe|never play|ban|skip this|change the vibe|different vibe|good pick|nice pick|love this|like this)\b/i;

export function summarizeSession(store: MemoryStore, sessionId: string): SessionSummaryResult {
  const messages = store.getSessionMessages(sessionId);
  const draft = buildDeterministicSessionSummary({ messages });
  const result: SessionSummaryResult = {
    summary: draft.summary,
    messageCount: messages.length
  };

  if (!draft.durable) {
    return result;
  }

  result.summaryId = store.addSessionSummary(sessionId, draft.summary, {
    generatedBy: "deterministic_session_summary",
    messageCount: messages.length
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
    durable
  };
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
