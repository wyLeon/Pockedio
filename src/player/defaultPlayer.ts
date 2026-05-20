import {
  startDuckedUrlWithIntro,
  startUrlPlayback as startAfplayUrlPlayback,
  type PlaybackHandle,
  type PlayerResult,
  type ProcessStarter
} from "./afplay.js";
import { isMpvAvailable, startMpvUrlPlayback } from "./mpv.js";

export async function playUrl(url: string): Promise<PlayerResult> {
  const handle = await startUrlPlayback(url);
  return handle.done;
}

export async function startUrlPlayback(url: string): Promise<PlaybackHandle> {
  if (isMpvAvailable()) {
    return startMpvUrlPlayback(url);
  }
  return startAfplayUrlPlayback(url);
}

export { startDuckedUrlWithIntro };
export type { PlaybackHandle, PlayerResult, ProcessStarter };
