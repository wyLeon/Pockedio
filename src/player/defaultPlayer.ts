import {
  startDuckedUrlWithIntro,
  startUrlPlayback as startAfplayUrlPlayback,
  type PlaybackHandle,
  type PlayerResult,
  type ProcessStarter
} from "./afplay.js";
import { isFfplayAvailable, startFfplayUrlPlayback } from "./ffplay.js";
import { isMpvAvailable, startMpvDuckedUrlWithIntro, startMpvUrlPlayback } from "./mpv.js";

export type DefaultPlayerOptions = {
  isMpvAvailable?: () => boolean;
  startMpvUrlPlayback?: (url: string) => Promise<PlaybackHandle>;
  startMpvDuckedUrlWithIntro?: (url: string, introFilePath: string) => Promise<PlaybackHandle>;
  isFfplayAvailable?: () => boolean;
  startFfplayUrlPlayback?: (url: string) => Promise<PlaybackHandle>;
  startAfplayUrlPlayback?: (url: string) => Promise<PlaybackHandle>;
  startAfplayDuckedUrlWithIntro?: (url: string, introFilePath: string) => Promise<PlaybackHandle>;
};

export async function playUrl(url: string): Promise<PlayerResult> {
  const handle = await startUrlPlayback(url);
  return handle.done;
}

export async function startUrlPlayback(url: string, options: DefaultPlayerOptions = {}): Promise<PlaybackHandle> {
  const canUseMpv = options.isMpvAvailable ?? isMpvAvailable;
  const startMpv = options.startMpvUrlPlayback ?? startMpvUrlPlayback;
  const canUseFfplay = options.isFfplayAvailable ?? isFfplayAvailable;
  const startFfplay = options.startFfplayUrlPlayback ?? startFfplayUrlPlayback;
  const startAfplay = options.startAfplayUrlPlayback ?? startAfplayUrlPlayback;

  if (canUseMpv()) {
    return startMpv(url);
  }
  if (canUseFfplay()) {
    return startFfplay(url);
  }
  return startAfplay(url);
}

export async function startDuckedUrlWithIntroDefault(
  url: string,
  introFilePath: string,
  options: DefaultPlayerOptions = {}
): Promise<PlaybackHandle> {
  const canUseMpv = options.isMpvAvailable ?? isMpvAvailable;
  const startMpvDucked = options.startMpvDuckedUrlWithIntro ?? startMpvDuckedUrlWithIntro;
  const startAfplayDucked = options.startAfplayDuckedUrlWithIntro ?? startDuckedUrlWithIntro;

  if (canUseMpv()) {
    return startMpvDucked(url, introFilePath);
  }
  return startAfplayDucked(url, introFilePath);
}

export { startDuckedUrlWithIntroDefault as startDuckedUrlWithIntro };
export type { PlaybackHandle, PlayerResult, ProcessStarter };
