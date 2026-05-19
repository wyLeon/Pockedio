import { describe, expect, it } from "vitest";
import { shouldUseSpokenDjAudio } from "../src/dj/voiceRules.js";
import { parseIntent } from "../src/session/intent.js";

describe("parseIntent", () => {
  it("maps direct playback language to direct playback", async () => {
    await expect(parseIntent("play it directly, no discussion")).resolves.toEqual({
      type: "direct_playback_request",
      confidence: "high"
    });
  });

  it("maps explicit DJ audio requests to explicit DJ audio", async () => {
    await expect(parseIntent("make me a spoken DJ intro for tonight")).resolves.toEqual({
      type: "explicit_dj_audio_request",
      confidence: "high"
    });
  });

  it("keeps ordinary playback as text-only playback intent", async () => {
    const intent = await parseIntent("play some late night jazz");

    expect(intent).toEqual({
      type: "playback_request",
      confidence: "high"
    });
    expect(shouldUseSpokenDjAudio({
      triggerType: "normal_playback",
      userExplicitlyRequestedDjAudio: intent.type === "explicit_dj_audio_request"
    })).toBe(false);
  });

  it("maps recommendation-only listening questions without starting playback", async () => {
    for (const input of [
      "I'm a little grumpy, what music should I listen to?",
      "I'm a little exhausted and want some relaxation, what music would suggest to me.",
      "I'm exhausted now, want some relaxation.",
      "what should I listen to?",
      "recommend music for a low mood",
      "suggest something relaxing for me",
      "what music should I listen to after a rough day?"
    ]) {
      await expect(parseIntent(input)).resolves.toEqual({
        type: "music_recommendation",
        confidence: "high"
      });
    }
  });

  it("maps conversational listening requests to playback", async () => {
    for (const input of [
      "Want to listen some pure musics to calm me down.",
      "I want some Chinese traditional style pure music to help me meditation.",
      "Some pure music helps me meditation.",
      "Chinese guqin music for deep focus.",
      "Need quiet instrumental tracks for reading."
    ]) {
      await expect(parseIntent(input)).resolves.toEqual({
        type: "playback_request",
        confidence: "high"
      });
    }
  });

  it("classifies common playback feedback", async () => {
    await expect(parseIntent("more like this one")).resolves.toEqual({
      type: "feedback_more_like_this",
      confidence: "high"
    });
    await expect(parseIntent("skip this")).resolves.toEqual({
      type: "feedback_skip",
      confidence: "high"
    });
    await expect(parseIntent("never play this artist again")).resolves.toEqual({
      type: "feedback_ban",
      confidence: "high"
    });
  });

  it("classifies playback status requests", async () => {
    await expect(parseIntent("what's playing?")).resolves.toEqual({
      type: "playback_status",
      confidence: "high"
    });
    await expect(parseIntent("show queue")).resolves.toEqual({
      type: "playback_status",
      confidence: "high"
    });
  });

  it("classifies identity and capability questions before music routing", async () => {
    for (const input of [
      "Who are you?",
      "Who is talking there?",
      "What can you do?",
      "Are you a real DJ?"
    ]) {
      await expect(parseIntent(input)).resolves.toEqual({
        type: "identity_capability",
        confidence: "high"
      });
    }
  });
});
