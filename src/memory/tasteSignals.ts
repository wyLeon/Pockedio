import type { StationTrack } from "../station/stationTypes.js";
import type { FeedbackAction, TasteSignalInput } from "./store.js";

export type FeedbackTasteSignalContext = {
  stationRequest?: string;
  note?: string;
};

export function buildFeedbackTasteSignals(input: {
  action: FeedbackAction;
  trackId: string | null;
  track?: StationTrack;
  context?: FeedbackTasteSignalContext;
}): Omit<TasteSignalInput, "sourceFeedbackId">[] {
  const signals: Omit<TasteSignalInput, "sourceFeedbackId">[] = [];
  const context = input.context;
  const trackTarget = input.track ? `${input.track.title} - ${input.track.artist}` : undefined;
  const artistTarget = input.track?.artist;
  const stationRequest = context?.stationRequest?.trim();

  const add = (signal: Omit<TasteSignalInput, "sourceFeedbackId">) => {
    if (signal.targetValue.trim()) {
      signals.push(signal);
    }
  };

  switch (input.action) {
    case "like":
      if (trackTarget) {
        add({ trackId: input.trackId, signalType: "positive_seed", targetType: "track", targetValue: trackTarget, weight: 1, context });
      }
      if (artistTarget) {
        add({ trackId: input.trackId, signalType: "positive_seed", targetType: "artist", targetValue: artistTarget, weight: 1, context });
      }
      break;
    case "more_like_this":
      if (trackTarget) {
        add({ trackId: input.trackId, signalType: "positive_seed", targetType: "track", targetValue: trackTarget, weight: 3, context });
      }
      if (artistTarget) {
        add({ trackId: input.trackId, signalType: "positive_seed", targetType: "artist", targetValue: artistTarget, weight: 2, context });
      }
      if (stationRequest) {
        add({ trackId: input.trackId, signalType: "positive_seed", targetType: "station_request", targetValue: stationRequest, weight: 2, context });
      }
      break;
    case "favorite":
      if (trackTarget) {
        add({ trackId: input.trackId, signalType: "favorite", targetType: "track", targetValue: trackTarget, weight: 5, context });
      }
      if (artistTarget) {
        add({ trackId: input.trackId, signalType: "positive_seed", targetType: "artist", targetValue: artistTarget, weight: 2, context });
      }
      break;
    case "skip":
      if (trackTarget) {
        add({ trackId: input.trackId, signalType: "negative_seed", targetType: "track", targetValue: trackTarget, weight: -1, context });
      }
      break;
    case "less_like_this":
      if (trackTarget) {
        add({ trackId: input.trackId, signalType: "negative_seed", targetType: "track", targetValue: trackTarget, weight: -2, context });
      }
      if (artistTarget) {
        add({ trackId: input.trackId, signalType: "negative_seed", targetType: "artist", targetValue: artistTarget, weight: -1, context });
      }
      break;
    case "change_vibe":
      if (stationRequest) {
        add({ trackId: input.trackId, signalType: "negative_seed", targetType: "station_request", targetValue: stationRequest, weight: -2, context });
      }
      break;
    case "ban":
      if (artistTarget) {
        add({ trackId: input.trackId, signalType: "ban", targetType: "artist", targetValue: artistTarget, weight: -999, context });
      } else if (trackTarget) {
        add({ trackId: input.trackId, signalType: "ban", targetType: "track", targetValue: trackTarget, weight: -999, context });
      }
      break;
    case "save_vibe":
      if (stationRequest) {
        add({ trackId: input.trackId, signalType: "vibe_preset", targetType: "vibe", targetValue: stationRequest, weight: 4, context });
      }
      break;
    case "stop":
      break;
  }

  return signals;
}
