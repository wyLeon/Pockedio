import type { GeneratedStation, StationTrack } from "../station/stationTypes.js";

export function formatStationIntro(station: GeneratedStation): string {
  const totalCount = station.tracks.length;
  const playableCount = station.tracks.filter((track) => track.playable.available).length;
  const requestLabel = /[\u3400-\u9fff]/.test(station.request)
    ? "this request"
    : `"${station.request}"`;
  return `I built ${formatStationSize(totalCount)} for ${requestLabel}. ${playableCount} track${playableCount === 1 ? "" : "s"} are playable now.`;
}

function formatStationSize(count: number): string {
  if (count === 5) {
    return "a five-track station";
  }
  if (count === 1) {
    return "a one-track station";
  }
  return `a ${count}-track station`;
}

export function formatDirectPlaybackConfirmation(station: GeneratedStation): string {
  const firstPlayable = station.tracks.find((track) => track.playable.available);
  if (!firstPlayable) {
    return formatUnavailableTrackFallback(station.tracks);
  }
  return `Starting with ${firstPlayable.title} by ${firstPlayable.artist}.`;
}

export function formatUnavailableTrackFallback(tracks: StationTrack[]): string {
  const unavailable = tracks.filter((track) => !track.playable.available);
  if (unavailable.length === 0) {
    return "Playback is ready.";
  }
  return `${unavailable.length} track${unavailable.length === 1 ? "" : "s"} could not be played, so I kept them in the station with fallback details.`;
}

export type FeedbackConfirmationContext = {
  track?: StationTrack;
  stationRequest?: string;
};

export function formatFeedbackConfirmation(action: string, context: FeedbackConfirmationContext = {}): string {
  const trackLabel = context.track ? formatTrackTitle(context.track) : "this one";
  const direction = formatListeningDirection(context);
  switch (action) {
    case "like":
      return `Got it. I’ll lean more toward ${trackLabel}${direction}.`;
    case "skip":
      return `Skipped ${trackLabel}. I’ll move away from this pick.`;
    case "ban":
      return `Understood. I’ll avoid ${trackLabel} in future sets.`;
    case "more_like_this":
      return `Got it. I’ll keep the next picks close to ${trackLabel}${direction}.`;
    case "change_vibe":
      return "Understood. I’ll shift the mood from here.";
    case "less_like_this":
      return `Got it. I’ll ease away from ${trackLabel} without banning it.`;
    case "favorite":
      return `Saved ${trackLabel} as a favorite. I’ll remember this for future sets.`;
    case "favorite_existing":
      return `${trackLabel} is already in your favorites.`;
    case "save_vibe":
      return `Saved this vibe${direction}. I can come back to it later.`;
    default:
      return "Noted.";
  }
}

function formatTrackTitle(track: StationTrack): string {
  return `"${track.title}"`;
}

function formatListeningDirection(context: FeedbackConfirmationContext): string {
  const rationale = context.track?.rationale;
  if (rationale && isHumanFacingRationale(rationale)) {
    return ` in this ${rationale.toLowerCase()} lane`;
  }
  const stationRequest = context.stationRequest ? formatStationRequest(context.stationRequest) : "";
  if (stationRequest) {
    return ` for ${stationRequest}`;
  }
  return "";
}

function isHumanFacingRationale(rationale: string): boolean {
  return !/\b(deterministic|fallback|llm|unavailable|local|signal|weight|confidence)\b/i.test(rationale);
}

function formatStationRequest(request: string): string {
  return request
    .replace(/^play\s+/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();
}

export function formatDjAudioFallbackText(text: string, reason: string): string {
  return `${text}\n\nDJ audio unavailable: ${reason}`;
}
