import type { LlmClient, LlmRequestOptions } from "../llm/llmClient.js";

export type SessionIntentType =
  | "conversation"
  | "identity_capability"
  | "music_recommendation"
  | "pending_station_confirmation"
  | "pending_station_decline"
  | "pending_station_dj_program"
  | "pending_station_refinement"
  | "playback_request"
  | "direct_playback_request"
  | "queue_position_playback"
  | "single_track_playback"
  | "single_track_selection"
  | "favorite_playback_request"
  | "favorite_list_request"
  | "feedback_like"
  | "feedback_skip"
  | "feedback_ban"
  | "feedback_more_like_this"
  | "feedback_change_vibe"
  | "feedback_less_like_this"
  | "feedback_favorite"
  | "feedback_save_vibe"
  | "taste_profile_update"
  | "session_memory_update"
  | "playback_status"
  | "pause"
  | "resume"
  | "replay"
  | "previous"
  | "stop"
  | "session_exit"
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
  "identity_capability",
  "music_recommendation",
  "pending_station_confirmation",
  "pending_station_decline",
  "pending_station_dj_program",
  "pending_station_refinement",
  "playback_request",
  "direct_playback_request",
  "queue_position_playback",
  "single_track_playback",
  "single_track_selection",
  "favorite_playback_request",
  "favorite_list_request",
  "feedback_like",
  "feedback_skip",
  "feedback_ban",
  "feedback_more_like_this",
  "feedback_change_vibe",
  "feedback_less_like_this",
  "feedback_favorite",
  "feedback_save_vibe",
  "taste_profile_update",
  "session_memory_update",
  "playback_status",
  "pause",
  "resume",
  "replay",
  "previous",
  "stop",
  "session_exit",
  "explicit_dj_audio_request"
]);

export async function parseIntent(input: string, llm?: LlmClient, options: LlmRequestOptions = {}): Promise<SessionIntent> {
  const deterministic = parseDeterministicIntent(input);
  if (deterministic.confidence === "high" || !llm) {
    return deterministic;
  }

  const result = await llm.generateJson<LlmIntentResponse>(
    [
      "Classify this Pockedio user message into one intent.",
      "Default to conversation unless the user clearly asks for playback, a recommendation, setup-like capability information, or a local playback control.",
      "Use identity_capability when the user asks who Pockedio is, who is talking, or what Pockedio can do.",
      "Use conversation for artist/song background questions, current-track questions, daily chat, personal reflections, or listening observations.",
      "Use playback_request only when the user asks to start music with words like play, put on, queue, or start.",
      "Use favorite_list_request when the user asks to list, show, or see locally saved favorite songs.",
      "Use pause for natural stop-temporarily wording like pause, hold on, wait a second, or stop for a moment.",
      "Use resume for natural continuation wording like resume, keep playing, continue the music, carry on, or go on.",
      "Use replay when the user asks to replay, restart, or play the current song again.",
      "Use previous for natural back-navigation wording like previous, go back, back one, or go to the previous track.",
      "Use single_track_playback when the user asks to play one specific song title, especially 'play [song] by [artist]'.",
      "Use music_recommendation when the user asks what music they should listen to but does not ask to play it.",
      "Use explicit_dj_audio_request only when the user asks for standalone spoken/audio DJ narration; the runner will redirect this toward station DJ mode.",
      "Use session_exit only when the user explicitly says quit or exit.",
      `Message: ${input}`
    ].join("\n"),
    "{ type: one supported intent string, confidence: high | medium | low }",
    options
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

  if (isPauseText(text)) {
    return { type: "pause", confidence: "high" };
  }
  if (isResumeText(text)) {
    return { type: "resume", confidence: "high" };
  }
  if (isReplayText(text)) {
    return { type: "replay", confidence: "high" };
  }
  if (isPreviousText(text)) {
    return { type: "previous", confidence: "high" };
  }
  if (/^(quit|exit)$/i.test(text) || /\b(quit|exit)\b/.test(text)) {
    return { type: "session_exit", confidence: "high" };
  }
  if (/\b(stop|shut up)\b/.test(text)) {
    return { type: "stop", confidence: "high" };
  }
  if (isIdentityCapabilityText(text)) {
    return { type: "identity_capability", confidence: "high" };
  }
  if (/\b(update|refresh|rebuild|summarize)\b.*\b(taste profile|taste\.md|music taste|taste memory)\b/.test(text)
    || /\b(taste profile|taste\.md|music taste|taste memory)\b.*\b(update|refresh|rebuild|summarize)\b/.test(text)) {
    return { type: "taste_profile_update", confidence: "high" };
  }
  if (/\b(summarize|update|refresh|save)\b.*\b(session memory|this session|memory)\b/.test(text)
    || /\b(session memory|this session|memory)\b.*\b(summarize|update|refresh|save)\b/.test(text)) {
    return { type: "session_memory_update", confidence: "high" };
  }
  if (/\b(never play|ban|block|don't play this artist|do not play this artist)\b/.test(text)) {
    return { type: "feedback_ban", confidence: "high" };
  }
  if (/\b(what'?s next|what is next|what comes next|up next)\b/.test(text)) {
    return { type: "playback_status", confidence: "high" };
  }
  if (/^(please\s+)?(skip|skip this|next|next one|next song|next track)(\s+please)?[.!?]*$/.test(text)) {
    return { type: "feedback_skip", confidence: "high" };
  }
  if (/\b(more like this|similar to this|keep this vibe)\b/.test(text)) {
    return { type: "feedback_more_like_this", confidence: "high" };
  }
  if (/\b(less like this|less of this|not so much like this)\b/.test(text)) {
    return { type: "feedback_less_like_this", confidence: "high" };
  }
  if (/\b(save this vibe|remember this vibe|keep this as a vibe)\b/.test(text)) {
    return { type: "feedback_save_vibe", confidence: "high" };
  }
  if (/\b(favorite (this|it)|save (this|it)|add (this|it) to (my )?best list)\b/.test(text)
    || /^(please\s+)?favorite\s+.+/.test(text)) {
    return { type: "feedback_favorite", confidence: "high" };
  }
  if (/\b(change the vibe|different vibe|switch the mood|change mood)\b/.test(text)) {
    return { type: "feedback_change_vibe", confidence: "high" };
  }
  if (/\b(what's playing|what is playing|current song|current track|show queue|where are we|what are we listening to|what'?s next|what is next|what comes next|up next)\b/.test(text)) {
    return { type: "playback_status", confidence: "high" };
  }
  if (/\b(like this|love this|good pick|nice pick)\b/.test(text)) {
    return { type: "feedback_like", confidence: "high" };
  }
  if (isDjProgramPlaybackText(text)) {
    return { type: "playback_request", confidence: "high" };
  }
  if (/\b(spoken|voice|audio intro|dj intro|dj-like audio|talk over|narrate)\b/.test(text)) {
    return { type: "explicit_dj_audio_request", confidence: "high" };
  }
  if (/\b(play it directly|play directly|direct playback|start playback|just play|no discussion)\b/.test(text)) {
    return { type: "direct_playback_request", confidence: "high" };
  }
  if (isFavoritePlaybackRequestText(text)) {
    return { type: "favorite_playback_request", confidence: "high" };
  }
  if (isFavoriteListRequestText(text)) {
    return { type: "favorite_list_request", confidence: "high" };
  }
  if (isSingleTrackPlaybackText(text)) {
    return { type: "single_track_playback", confidence: "high" };
  }
  if (isMusicRecommendationText(text)) {
    return { type: "music_recommendation", confidence: "high" };
  }
  if (isOpenEndedStationSuggestionText(text)) {
    return { type: "music_recommendation", confidence: "high" };
  }
  if (isPlaybackRequestText(text)) {
    return { type: "playback_request", confidence: "high" };
  }

  return { type: "conversation", confidence: "medium" };
}

function isPauseText(text: string): boolean {
  return /\bpause\b/.test(text)
    || /^(please\s+)?(hold on|hold on a second|hold on a minute|hold up|wait|wait a second|wait a minute|stop for a moment|stop for a second|pause for a moment)(\s+please)?[.!?]*$/.test(text);
}

function isResumeText(text: string): boolean {
  return /\bresume\b/.test(text)
    || /^(please\s+)?(keep playing|continue playing|continue the music|carry on|go on|keep going|play on)(\s+please)?[.!?]*$/.test(text);
}

function isReplayText(text: string): boolean {
  return /^(please\s+)?(replay|replay this|replay this song|replay this track|restart|restart this|restart this song|restart this track|play this again|play this song again|play this track again|again)(\s+please)?[.!?]*$/.test(text);
}

function isPreviousText(text: string): boolean {
  return /^(please\s+)?(previous|prev|previous song|previous track|go back|back one|go back one|play previous|play the previous song|play the previous track|go to previous|go to the previous song|go to the previous track)(\s+please)?[.!?]*$/.test(text);
}

function isIdentityCapabilityText(text: string): boolean {
  return /\b(who are you|who is talking|who'?s talking|what are you|what can you do|what do you do|how do you work|are you a real dj)\b/.test(text)
    || /^(help|help me)$/i.test(text);
}

function isMusicRecommendationText(text: string): boolean {
  return /\b(what music should i listen to|what music would .*suggest|what should i listen to|what should i play|recommend music|recommend some music|suggest music|suggest some music|suggest something|what .*music.*suggest)\b/.test(text)
    || /\b(i'?m|i am|feeling|feel)\b.*\b(exhausted|tired|stressed|grumpy|sad|anxious)\b.*\b(relax|relaxation|calm|rest|unwind)\b/.test(text)
    || /(应该|适合).{0,8}听什么|听什么.{0,8}(好|合适|适合)|推荐.{0,8}(音乐|歌|歌曲)|建议.{0,8}(音乐|歌|歌曲)/.test(text);
}

function isOpenEndedStationSuggestionText(text: string): boolean {
  return /^want\s+(?:some|something)\b/.test(text)
    || /^(?:give me|give something|something for)\b/.test(text);
}

function isPlaybackRequestText(text: string): boolean {
  return hasPlaybackCommand(text)
    || hasMusicSubjectWithAction(text)
    || hasMusicSubjectWithUseCase(text);
}

function isFavoritePlaybackRequestText(text: string): boolean {
  return /\b(play|put on|queue|start|listen to|hear)\b.*\b(my favorite song|my favourite song|one of my favorites|one of my favourites|something from my favorites|something from my favourites|my saved favorite|my saved favourite|favorite track|favourite track)\b/.test(text);
}

function isFavoriteListRequestText(text: string): boolean {
  return /\b(list|show|see|view|what are|what're|tell me)\b.*\b(my )?(favorite|favourite|saved|liked)\s+(songs|tracks|music)\b/.test(text)
    || /\b(my )?(favorite|favourite|saved|liked)\s+(songs|tracks|music)\b.*\b(list|show|see|view)\b/.test(text);
}

function isDjProgramPlaybackText(text: string): boolean {
  return /\b(dj program|dj version|radio show|radio version|spoken version)\b/.test(text)
    && /\b(play|start|create|make|build|give me|put on|queue|want|would like|need)\b/.test(text);
}

function isSingleTrackPlaybackText(text: string): boolean {
  const directSong = text.match(/^(?:please\s+)?(?:play|put on|queue|start)\s+(.+)$/);
  if (!directSong) {
    return false;
  }

  const requested = directSong[1].trim();
  if (!requested || requested.length > 90) {
    return false;
  }
  if (/\b(song|track|music|songs|tracks|playlist|station|set|vibe|mood|something|some|anything|more|similar|like this|like that)\b/.test(requested)) {
    return false;
  }
  if (/\b(for|around|based on|in the style of|sounds like|similar to)\b/.test(requested)) {
    return false;
  }
  if (/^(jazz|ambient|classical|piano|lofi|lo-fi|rock|pop|edm|folk|hip hop|r&b|instrumental|chill|relaxing|focus)$/i.test(requested)) {
    return false;
  }

  return /\sby\s.+/.test(requested) || requested.split(/\s+/).length <= 8;
}

function hasPlaybackCommand(text: string): boolean {
  return /\b(play|put on|give me|queue|start)\b/.test(text);
}

function hasMusicSubjectWithAction(text: string): boolean {
  return /\b(listen|hear|want|need|would like)\b.*\b(music|musics|song|songs|track|tracks|playlist|set)\b/.test(text)
    || /(想听|想要听|放点|来点|播放|给我).{0,16}(音乐|歌|歌曲|钢琴|爵士|氛围|放松|纯音乐)/.test(text);
}

function hasMusicSubjectWithUseCase(text: string): boolean {
  return /\b(music|musics|song|songs|track|tracks|playlist|set|instrumental|instrumentals|pure music|guqin|guzheng|piano|jazz|ambient)\b/.test(text)
    && /\b(calm|calming|meditation|meditate|focus|deep work|reading|sleep|relax|relaxing|study|work|quiet|peaceful)\b/.test(text);
}
