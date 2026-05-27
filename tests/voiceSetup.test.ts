import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFishVoicePreview,
  buildMacosVoicePreview,
  kokoroVoiceLanguage,
  kokoroVoiceOptions,
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

  it("exposes the curated Kokoro fast local voices", () => {
    expect(kokoroVoiceOptions.map((voice) => voice.id)).toEqual([
      "af_kore",
      "af_nicole",
      "bf_isabella",
      "am_michael",
      "am_onyx",
      "bm_daniel",
      "bm_george",
      "bm_lewis"
    ]);
    expect(kokoroVoiceLanguage("bf_isabella")).toBe("en-gb");
    expect(kokoroVoiceLanguage("af_nicole")).toBe("en-us");
  });
});
