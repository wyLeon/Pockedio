import path from "node:path";
import type { FishVoice, KokoroVoice, MacosVoice } from "../config/schema.js";

export const voicePreviewText = "Welcome back. I picked a warmer five-track set for this station.";

export type VoicePreviewCommand = {
  command: string;
  args: string[];
  label: string;
  sampleText: string;
};

export const macosVoiceOptions: Array<{
  id: MacosVoice;
  label: string;
  sayVoice: string;
  description: string;
}> = [
  { id: "lumen", label: "Lumen", sayVoice: "Samantha", description: "clear, familiar, easygoing" },
  { id: "sable", label: "Sable", sayVoice: "Moira", description: "soft, intimate, late-night" },
  { id: "arden", label: "Arden", sayVoice: "Daniel", description: "steady, polished, radio-like" },
  { id: "vale", label: "Vale", sayVoice: "Karen", description: "warm, neutral, default" },
  { id: "sol", label: "Sol", sayVoice: "Tessa", description: "bright, relaxed, upbeat" }
];

export const fishVoiceOptions: Array<{
  id: FishVoice;
  label: string;
  description: string;
}> = [
  { id: "mina", label: "Mina", description: "warm, calm, personal radio" },
  { id: "nova", label: "Nova", description: "clean, modern, broadcast voice" }
];

export const kokoroVoiceOptions: Array<{
  id: KokoroVoice;
  label: string;
  description: string;
  lang: "en-us" | "en-gb";
}> = [
  { id: "af_kore", label: "Kore", description: "clear, composed, fast local voice", lang: "en-us" },
  { id: "af_nicole", label: "Nicole", description: "soft, close, fast local voice", lang: "en-us" },
  { id: "bf_isabella", label: "Isabella", description: "polished British fast local voice", lang: "en-gb" },
  { id: "am_michael", label: "Michael", description: "steady, grounded, fast local voice", lang: "en-us" },
  { id: "am_onyx", label: "Onyx", description: "low, direct, fast local voice", lang: "en-us" },
  { id: "bm_daniel", label: "Daniel", description: "clean British fast local voice", lang: "en-gb" },
  { id: "bm_george", label: "George", description: "warm British fast local voice", lang: "en-gb" },
  { id: "bm_lewis", label: "Lewis", description: "relaxed British fast local voice", lang: "en-gb" }
];

export function formatMacosVoiceName(id: MacosVoice): string {
  return macosVoiceOptions.find((voice) => voice.id === id)?.label ?? id;
}

export function formatKokoroVoiceName(id: KokoroVoice): string {
  return kokoroVoiceOptions.find((voice) => voice.id === id)?.label ?? id;
}

export function kokoroVoiceLanguage(id: KokoroVoice): "en-us" | "en-gb" {
  return kokoroVoiceOptions.find((voice) => voice.id === id)?.lang ?? "en-us";
}

export function formatFishVoiceName(id: FishVoice): string {
  return fishVoiceOptions.find((voice) => voice.id === id)?.label ?? id;
}

export function buildMacosVoicePreview(id: MacosVoice): VoicePreviewCommand {
  const voice = macosVoiceOptions.find((candidate) => candidate.id === id) ?? macosVoiceOptions[3]!;
  return {
    command: "say",
    args: ["-v", voice.sayVoice, voicePreviewText],
    label: voice.label,
    sampleText: voicePreviewText
  };
}

export function buildFishVoicePreview(id: FishVoice, pockedioHome: string): VoicePreviewCommand {
  return {
    command: "afplay",
    args: [path.join(pockedioHome, "audio", "previews", `${id}.wav`)],
    label: formatFishVoiceName(id),
    sampleText: voicePreviewText
  };
}
