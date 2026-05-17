export type MusicSearchQuery = {
  keyword: string;
};

export type MusicTrackCandidate = {
  provider: string;
  providerTrackId: string;
  title: string;
  artists: string[];
  album?: string | null;
};

export type PlayableTrack =
  | {
      available: true;
      provider: string;
      providerTrackId: string;
      playableUrl: string;
      urlType?: string | null;
    }
  | {
      available: false;
      provider: string;
      providerTrackId: string;
      reason: string;
      code?: number | null;
    };

export type MusicProvider = {
  search(query: MusicSearchQuery, limit: number): Promise<MusicTrackCandidate[]>;
  getPlayableUrl(trackId: string): Promise<PlayableTrack>;
};
