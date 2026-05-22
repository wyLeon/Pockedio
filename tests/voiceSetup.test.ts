import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFishVoicePreview,
  buildMacosVoicePreview,
  macosVoiceOptions,
  voicePreviewText
} from "../src/tts/voiceSetup.js";

describe("voice setup previews", () => {
  it("maps Pockedio macOS voice names to concrete say voices", () => {
    expect(macosVoiceOptions.map((voice) => voice.id)).toEqual(["lumen", "sable", "arden", "vale", "sol"]);
    expect(buildMacosVoicePreview("vale")).toEqual({
      command: "say",
      args: ["-v", "Karen", voicePreviewText],
      label: "Vale",
      sampleText: voicePreviewText
    });
  });

  it("uses local Fish preview files for Mina and Nova", () => {
    expect(buildFishVoicePreview("nova", "/tmp/pockedio")).toEqual({
      command: "afplay",
      args: [path.join("/tmp/pockedio", "audio", "previews", "nova.wav")],
      label: "Nova",
      sampleText: voicePreviewText
    });
  });
});
