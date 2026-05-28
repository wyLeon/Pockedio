import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { shouldUseSpokenDjAudio } from "../src/dj/voiceRules.js";
import { synthesizeFishAudio, type FishAudioProcessRunner } from "../src/tts/fishAudio.js";
import { synthesizeDjAudio, type DjAudioProcessRunner } from "../src/tts/djAudio.js";
import { synthesizeKokoroAudio, type KokoroAudioProcessRunner } from "../src/tts/kokoroAudio.js";

function makeConfig() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-voice-test-"));
  return loadConfig({ POCKEDIO_HOME: home });
}

describe("spoken DJ voice rules", () => {
  it("does not speak for normal user-active playback by default", () => {
    expect(shouldUseSpokenDjAudio({
      triggerType: "normal_playback",
      userExplicitlyRequestedDjAudio: false
    })).toBe(false);
  });

  it("speaks for scheduled morning and evening DJ scenes", () => {
    expect(shouldUseSpokenDjAudio({
      triggerType: "scheduled_morning",
      userExplicitlyRequestedDjAudio: false
    })).toBe(true);
    expect(shouldUseSpokenDjAudio({
      triggerType: "scheduled_evening",
      userExplicitlyRequestedDjAudio: false
    })).toBe(true);
  });

  it("speaks when the user explicitly asks for DJ-like audio", () => {
    expect(shouldUseSpokenDjAudio({
      triggerType: "conversation",
      userExplicitlyRequestedDjAudio: true
    })).toBe(true);
  });

  it("does not speak for mood checks unless explicitly requested", () => {
    expect(shouldUseSpokenDjAudio({
      triggerType: "mood_check",
      userExplicitlyRequestedDjAudio: false
    })).toBe(false);
  });
});

describe("FishAudio adapter", () => {
  it("returns a structured failure when synthesis exits non-zero", async () => {
    const runner: FishAudioProcessRunner = async () => ({
      ok: false,
      exitCode: 2,
      signal: null,
      stdout: "",
      stderr: "model failed"
    });

    const result = await synthesizeFishAudio(makeConfig(), "Good morning.", { runner });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("model failed");
    expect(result.audioPath).toMatch(/\.wav$/);
  });

  it("returns the generated WAV path when synthesis succeeds", async () => {
    const runner: FishAudioProcessRunner = async (_command, args) => {
      const outputIndex = args.indexOf("--output");
      fs.writeFileSync(args[outputIndex + 1], "fake wav");
      return {
        ok: true,
        exitCode: 0,
        signal: null,
        stdout: "",
        stderr: ""
      };
    };

    const result = await synthesizeFishAudio(makeConfig(), "Play something warm.", { runner });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.audioPath).toMatch(/\.wav$/);
      expect(fs.existsSync(result.audioPath)).toBe(true);
    }
  });

  it("passes configured reference audio and text to FishAudio", async () => {
    const config = makeConfig();
    const referenceAudioPath = path.join(path.dirname(config.paths.database), "mina.wav");
    fs.mkdirSync(path.dirname(referenceAudioPath), { recursive: true });
    fs.writeFileSync(referenceAudioPath, "fake reference wav");
    config.fishAudio.referenceAudioPath = referenceAudioPath;
    config.fishAudio.referenceText = "Mina is here. Soft lights, warm songs, and a little room to breathe.";
    let observedArgs: string[] = [];
    const runner: FishAudioProcessRunner = async (_command, args) => {
      observedArgs = args;
      const outputIndex = args.indexOf("--output");
      fs.writeFileSync(args[outputIndex + 1], "fake wav");
      return {
        ok: true,
        exitCode: 0,
        signal: null,
        stdout: "",
        stderr: ""
      };
    };

    await synthesizeFishAudio(config, "Track two is ready.", { runner });

    expect(observedArgs).toContain("--reference-audio");
    expect(observedArgs).toContain(referenceAudioPath);
    expect(observedArgs).toContain("--reference-text");
    expect(observedArgs).toContain(config.fishAudio.referenceText);
  });
});

describe("KokoroAudio adapter", () => {
  it("passes configured model, voices, voice, and language to Kokoro", async () => {
    const config = makeConfig();
    config.tts.kokoroVoice = "bf_isabella";
    config.kokoroAudio.pythonPath = "/kokoro-python";
    config.kokoroAudio.modelPath = "/kokoro.onnx";
    config.kokoroAudio.voicesPath = "/voices.bin";
    let observedCommand = "";
    let observedArgs: string[] = [];
    const runner: KokoroAudioProcessRunner = async (command, args) => {
      observedCommand = command;
      observedArgs = args;
      const output = args.at(-1)!;
      fs.writeFileSync(output, "wav");
      return { ok: true, exitCode: 0, signal: null, stdout: "", stderr: "" };
    };

    const result = await synthesizeKokoroAudio(config, "Welcome back.", { runner });

    expect(result.ok).toBe(true);
    expect(observedCommand).toBe("/kokoro-python");
    expect(observedArgs).toContain("/kokoro.onnx");
    expect(observedArgs).toContain("/voices.bin");
    expect(observedArgs).toContain("bf_isabella");
    expect(observedArgs).toContain("en-gb");
  });
});

describe("DJ audio provider resolution", () => {
  it("uses text fallback when TTS provider is text", async () => {
    const config = makeConfig();
    config.tts.provider = "text";

    const result = await synthesizeDjAudio(config, "Welcome back.");

    expect(result).toEqual({
      ok: false,
      latencyMs: expect.any(Number),
      error: "Text-only DJ copy is selected."
    });
  });

  it("uses macOS say when macOS TTS is selected", async () => {
    const config = makeConfig();
    config.tts.provider = "macos";
    config.tts.macosVoice = "sable";
    let observedCommand = "";
    let observedArgs: string[] = [];
    const runner: DjAudioProcessRunner = async (command, args) => {
      observedCommand = command;
      observedArgs = args;
      const output = args[args.indexOf("-o") + 1]!;
      fs.writeFileSync(output, "aiff");
      return { ok: true, exitCode: 0, signal: null, stdout: "", stderr: "" };
    };

    const result = await synthesizeDjAudio(config, "Welcome back.", {
      platform: "darwin",
      runner
    });

    expect(result.ok).toBe(true);
    expect(observedCommand).toBe("say");
    expect(observedArgs).toContain("Moira");
    expect(observedArgs).toContain("-o");
  });

  it("uses FishAudio when Fish TTS is selected", async () => {
    const config = makeConfig();
    config.tts.provider = "fish";
    let observedText = "";
    const runner: FishAudioProcessRunner = async (_command, args) => {
      observedText = args[args.indexOf("--text") + 1]!;
      const output = args[args.indexOf("--output") + 1]!;
      fs.writeFileSync(output, "wav");
      return { ok: true, exitCode: 0, signal: null, stdout: "", stderr: "" };
    };

    const result = await synthesizeDjAudio(config, "Here's \"Sway It Hula Girl\" by 小野リサ.", { fishRunner: runner });

    expect(result.ok).toBe(true);
    expect(observedText).toBe("Here's \"Sway It Hula Girl\" by 小野リサ.");
    if (result.ok) {
      expect(result.audioPath).toMatch(/\.wav$/);
    }
  });

  it("uses Kokoro when Kokoro TTS is selected", async () => {
    const config = makeConfig();
    config.tts.provider = "kokoro";
    config.tts.kokoroVoice = "am_onyx";
    let observedText = "";
    const runner: KokoroAudioProcessRunner = async (_command, args) => {
      observedText = args.at(-2)!;
      const output = args.at(-1)!;
      fs.writeFileSync(output, "wav");
      return { ok: true, exitCode: 0, signal: null, stdout: "", stderr: "" };
    };

    const result = await synthesizeDjAudio(config, "Here's \"Sway It Hula Girl\" by 小野リサ.", { kokoroRunner: runner });

    expect(result.ok).toBe(true);
    expect(observedText).toBe("Here's \"Sway It Hula Girl\" by Lisa Ono.");
    if (result.ok) {
      expect(result.audioPath).toMatch(/\.wav$/);
    }
  });

  it("keeps unknown CJK artist names out of Kokoro spoken text", async () => {
    const config = makeConfig();
    config.tts.provider = "kokoro";
    let observedText = "";
    const runner: KokoroAudioProcessRunner = async (_command, args) => {
      observedText = args.at(-2)!;
      const output = args.at(-1)!;
      fs.writeFileSync(output, "wav");
      return { ok: true, exitCode: 0, signal: null, stdout: "", stderr: "" };
    };

    const result = await synthesizeDjAudio(config, "Here's \"Midnight\" by 王小明.", { kokoroRunner: runner });

    expect(result.ok).toBe(true);
    expect(observedText).toBe("Here's \"Midnight\" next.");
  });

  it("keeps Kokoro unknown-artist fallback from swallowing the rest of the sentence", async () => {
    const config = makeConfig();
    config.tts.provider = "kokoro";
    let observedText = "";
    const runner: KokoroAudioProcessRunner = async (_command, args) => {
      observedText = args.at(-2)!;
      const output = args.at(-1)!;
      fs.writeFileSync(output, "wav");
      return { ok: true, exitCode: 0, signal: null, stdout: "", stderr: "" };
    };

    const result = await synthesizeDjAudio(config, "Here's \"Midnight\" by 王小明, a soft opener.", { kokoroRunner: runner });

    expect(result.ok).toBe(true);
    expect(observedText).toBe("Here's \"Midnight\" next, a soft opener.");
  });

  it("keeps unknown CJK lead artist names out of Kokoro first-up copy", async () => {
    const config = makeConfig();
    config.tts.provider = "kokoro";
    config.tts.kokoroVoice = "af_nicole";
    let observedText = "";
    const runner: KokoroAudioProcessRunner = async (_command, args) => {
      observedText = args.at(-2)!;
      const output = args.at(-1)!;
      fs.writeFileSync(output, "wav");
      return { ok: true, exitCode: 0, signal: null, stdout: "", stderr: "" };
    };

    const result = await synthesizeDjAudio(config, "First up, 陶喆 with that playful, funky vibe.", { kokoroRunner: runner });

    expect(result.ok).toBe(true);
    expect(observedText).toBe("First up, this track with that playful, funky vibe.");
  });
});
