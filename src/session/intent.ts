import type { LlmClient } from "../llm/llmClient.js";

export type SessionIntentType =
  | "conversation"
  | "playback_request"
  | "direct_playback_request"
  | "feedback_like"
  | "feedback_skip"
  | "feedback_ban"
  | "feedback_more_like_this"
  | "feedback_change_vibe"
  | "playback_status"
  | "stop"
  | "explicit_dj_audio_request";

export type SessionIntent = {
  type: SessionIntentType;
  confidence: "high" | "medium" | "low";
};

type LlmIntentResponse = {
  type?: unknown;
  confidence?: unknown;
};

const intentTypes = new Set<SessionIntentType>([
  "conversation",
  "playback_request",
  "direct_playback_request",
  "feedback_like",
  "feedback_skip",
  "feedback_ban",
  "feedback_more_like_this",
  "feedback_change_vibe",
  "playback_status",
  "stop",
  "explicit_dj_audio_request"
]);

export async function parseIntent(input: string, llm?: LlmClient): Promise<SessionIntent> {
  const deterministic = parseDeterministicIntent(input);
  if (deterministic.confidence === "high" || !llm) {
    return deterministic;
  }

  const result = await llm.generateJson<LlmIntentResponse>(
    [
      "Classify this Pockedio user message into one intent.",
      "Prefer playback_request for ordinary music requests.",
      "Use explicit_dj_audio_request only when the user asks for spoken/audio DJ narration.",
      `Message: ${input}`
    ].join("\n"),
    "{ type: one supported intent string, confidence: high | medium | low }"
  );
  if (!result.ok) {
    return deterministic;
  }

  const type = typeof result.value.type === "string" && intentTypes.has(result.value.type as SessionIntentType)
    ? result.value.type as SessionIntentType
    : deterministic.type;
  const confidence = result.value.confidence === "high" || result.value.confidence === "medium" || result.value.confidence === "low"
    ? result.value.confidence
    : "medium";

  return { type, confidence };
}

export function parseDeterministicIntent(input: string): SessionIntent {
  const text = input.trim().toLowerCase();
  if (!text) {
    return { type: "conversation", confidence: "low" };
  }

  if (/\b(stop|pause|quit|exit|shut up)\b/.test(text)) {
    return { type: "stop", confidence: "high" };
  }
  if (/\b(never play|ban|block|don't play this artist|do not play this artist)\b/.test(text)) {
    return { type: "feedback_ban", confidence: "high" };
  }
  if (/\b(skip|next|next song|next track)\b/.test(text)) {
    return { type: "feedback_skip", confidence: "high" };
  }
  if (/\b(more like this|similar to this|keep this vibe)\b/.test(text)) {
    return { type: "feedback_more_like_this", confidence: "high" };
  }
  if (/\b(change the vibe|different vibe|switch the mood|change mood)\b/.test(text)) {
    return { type: "feedback_change_vibe", confidence: "high" };
  }
  if (/\b(what's playing|what is playing|current song|current track|show queue|where are we|what are we listening to)\b/.test(text)) {
    return { type: "playback_status", confidence: "high" };
  }
  if (/\b(like this|love this|good pick|nice pick)\b/.test(text)) {
    return { type: "feedback_like", confidence: "high" };
  }
  if (/\b(spoken|voice|audio intro|dj intro|dj-like audio|talk over|narrate)\b/.test(text)) {
    return { type: "explicit_dj_audio_request", confidence: "high" };
  }
  if (/\b(play it directly|play directly|direct playback|start playback|just play|no discussion)\b/.test(text)) {
    return { type: "direct_playback_request", confidence: "high" };
  }
  if (/\b(play|put on|give me|queue|start)\b/.test(text) || /\b(listen|hear)\b.*\b(music|musics|song|songs|track|tracks|playlist|set)\b/.test(text)) {
    return { type: "playback_request", confidence: "high" };
  }

  return { type: "conversation", confidence: "medium" };
}
