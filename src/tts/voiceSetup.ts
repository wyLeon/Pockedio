import path from "node:path";
import type { FishVoice, MacosVoice } from "../config/schema.js";

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

export function formatMacosVoiceName(id: MacosVoice): string {
  return macosVoiceOptions.find((voice) => voice.id === id)?.label ?? id;
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
