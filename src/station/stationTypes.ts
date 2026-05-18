import type { PlayableTrack } from "../providers/musicProvider.js";

export type PlannedStationTrack = {
  title: string;
  artist: string;
  rationale: string;
};

export type StationTrack = PlannedStationTrack & {
  position: number;
  provider: string;
  providerTrackId: string | null;
  album?: string | null;
  playable: PlayableTrack;
};

export type GeneratedStation = {
  request: string;
  source: "llm" | "fallback";
  tracks: StationTrack[];
};
