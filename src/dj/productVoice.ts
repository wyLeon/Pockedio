import type { GeneratedStation, StationTrack } from "../station/stationTypes.js";

export function formatStationIntro(station: GeneratedStation): string {
  const playableCount = station.tracks.filter((track) => track.playable.available).length;
  const requestLabel = /[\u3400-\u9fff]/.test(station.request)
    ? "this request"
    : `"${station.request}"`;
  return `I built a five-track station for ${requestLabel}. ${playableCount} track${playableCount === 1 ? "" : "s"} are playable now.`;
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

export function formatFeedbackConfirmation(action: string): string {
  switch (action) {
    case "like":
      return "Noted. I will weigh this direction more strongly.";
    case "skip":
      return "Skipped. I will move away from this pick.";
    case "ban":
      return "Understood. I will avoid this in future sets.";
    case "more_like_this":
      return "Noted. I will stay near this lane.";
    case "change_vibe":
      return "Understood. I will shift the mood.";
    default:
      return "Noted.";
  }
}

export function formatDjAudioFallbackText(text: string, reason: string): string {
  return `${text}\n\nDJ audio unavailable: ${reason}`;
}
