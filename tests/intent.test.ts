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

  it("routes standalone DJ audio requests to the deprecated standalone DJ audio path", async () => {
    await expect(parseIntent("make me a spoken DJ intro for tonight")).resolves.toEqual({
      type: "explicit_dj_audio_request",
      confidence: "high"
    });
  });

  it("routes DJ program requests through station playback instead of standalone voice", async () => {
    for (const input of [
      "I want a DJ program.",
      "I want a DJ program for late night focus.",
      "Some soft jazz, dj mode",
      "Want some soft jazz, dj mode"
    ]) {
      await expect(parseIntent(input)).resolves.toEqual({
        type: "playback_request",
        confidence: "high"
      });
    }
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

  it("maps specific song requests to single-track playback", async () => {
    await expect(parseIntent("play To Be Alone With You by Sufjan Stevens")).resolves.toEqual({
      type: "single_track_playback",
      confidence: "high"
    });
    await expect(parseIntent("play Intro")).resolves.toEqual({
      type: "single_track_playback",
      confidence: "high"
    });
  });

  it("keeps broad playback requests as station playback", async () => {
    for (const input of [
      "play something for deep work",
      "play some late night jazz",
      "put on something for a rainy commute",
      "play something like To Be Alone With You",
      "play relaxing music",
      "play songs by Sufjan Stevens",
      "play songs from Mina Okabe"
    ]) {
      await expect(parseIntent(input)).resolves.toEqual({
        type: "playback_request",
        confidence: "high"
      });
    }
  });

  it("maps recommendation-only listening questions without starting playback", async () => {
    for (const input of [
      "I'm a little grumpy, what music should I listen to?",
      "I'm a little exhausted and want some relaxation, what music would suggest to me.",
      "I'm exhausted now, want some relaxation.",
      "Want some soft jazz to start a rainy morning.",
      "Give me something to start my new day.",
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
    await expect(parseIntent("less like this")).resolves.toEqual({
      type: "feedback_less_like_this",
      confidence: "high"
    });
    await expect(parseIntent("dont like this one")).resolves.toEqual({
      type: "feedback_less_like_this",
      confidence: "high"
    });
    await expect(parseIntent("don't like this one")).resolves.toEqual({
      type: "feedback_less_like_this",
      confidence: "high"
    });
    await expect(parseIntent("favorite this")).resolves.toEqual({
      type: "feedback_favorite",
      confidence: "high"
    });
    await expect(parseIntent("Love this song, favorite it")).resolves.toEqual({
      type: "feedback_favorite",
      confidence: "high"
    });
    await expect(parseIntent("Favorite River Of Tears")).resolves.toEqual({
      type: "feedback_favorite",
      confidence: "high"
    });
    await expect(parseIntent("can you give me the full lyrics?")).resolves.toEqual({
      type: "conversation",
      confidence: "high"
    });
    await expect(parseIntent("save this vibe")).resolves.toEqual({
      type: "feedback_save_vibe",
      confidence: "high"
    });
  });

  it("classifies favorite playback requests", async () => {
    await expect(parseIntent("play my favorite song")).resolves.toEqual({
      type: "favorite_playback_request",
      confidence: "high"
    });
    await expect(parseIntent("play one of my favorites")).resolves.toEqual({
      type: "favorite_playback_request",
      confidence: "high"
    });
    await expect(parseIntent("play something from my favorites")).resolves.toEqual({
      type: "favorite_playback_request",
      confidence: "high"
    });
  });

  it("classifies favorite list requests", async () => {
    await expect(parseIntent("List my favorite songs")).resolves.toEqual({
      type: "favorite_list_request",
      confidence: "high"
    });
    await expect(parseIntent("show my saved tracks")).resolves.toEqual({
      type: "favorite_list_request",
      confidence: "high"
    });
  });

  it("classifies favorite removal requests", async () => {
    await expect(parseIntent("remove favorite 2")).resolves.toEqual({
      type: "favorite_remove_request",
      confidence: "high"
    });
    await expect(parseIntent("delete City Of Stars from favorites")).resolves.toEqual({
      type: "favorite_remove_request",
      confidence: "high"
    });
  });

  it("classifies playback status requests", async () => {
    await expect(parseIntent("what's playing?")).resolves.toEqual({
      type: "playback_status",
      confidence: "high"
    });
    await expect(parseIntent("what's next?")).resolves.toEqual({
      type: "playback_status",
      confidence: "high"
    });
    await expect(parseIntent("show queue")).resolves.toEqual({
      type: "playback_status",
      confidence: "high"
    });
  });

  it("classifies next one as a playback skip control", async () => {
    await expect(parseIntent("next one")).resolves.toEqual({
      type: "feedback_skip",
      confidence: "high"
    });
  });

  it("classifies pause and resume as separate controls", async () => {
    await expect(parseIntent("continue this vibe")).resolves.toEqual({
      type: "last_vibe_continuation",
      confidence: "high"
    });
    await expect(parseIntent("continue last vibe")).resolves.toEqual({
      type: "last_vibe_continuation",
      confidence: "high"
    });
    await expect(parseIntent("pause")).resolves.toEqual({
      type: "pause",
      confidence: "high"
    });
    await expect(parseIntent("hold on a second")).resolves.toEqual({
      type: "pause",
      confidence: "high"
    });
    await expect(parseIntent("resume")).resolves.toEqual({
      type: "resume",
      confidence: "high"
    });
    await expect(parseIntent("keep playing")).resolves.toEqual({
      type: "resume",
      confidence: "high"
    });
    await expect(parseIntent("continue the music")).resolves.toEqual({
      type: "resume",
      confidence: "high"
    });
    await expect(parseIntent("replay this song")).resolves.toEqual({
      type: "replay",
      confidence: "high"
    });
    await expect(parseIntent("play this again")).resolves.toEqual({
      type: "replay",
      confidence: "high"
    });
    await expect(parseIntent("previous")).resolves.toEqual({
      type: "previous",
      confidence: "high"
    });
    await expect(parseIntent("go back")).resolves.toEqual({
      type: "previous",
      confidence: "high"
    });
    await expect(parseIntent("go to the previous track")).resolves.toEqual({
      type: "previous",
      confidence: "high"
    });
  });

  it("lets the LLM classify semantic playback-control wording beyond deterministic phrases", async () => {
    const prompts: string[] = [];
    await expect(parseIntent("let it roll again", {
      generateJson: async (prompt) => {
        prompts.push(prompt);
        return { ok: true, value: { type: "resume", confidence: "high" } };
      },
      generateText: async () => ({ ok: true, value: "unused" })
    })).resolves.toEqual({
      type: "resume",
      confidence: "high"
    });

    expect(prompts[0]).toContain("Use resume for natural continuation wording");
    expect(prompts[0]).toContain("Use pause for natural stop-temporarily wording");
    expect(prompts[0]).toContain("Use previous for natural back-navigation wording");
  });

  it("keeps stop as playback control, menu as main menu, and quit or exit as session exit", async () => {
    await expect(parseIntent("stop")).resolves.toEqual({
      type: "stop",
      confidence: "high"
    });
    await expect(parseIntent("menu")).resolves.toEqual({
      type: "main_menu",
      confidence: "high"
    });
    await expect(parseIntent("return to main menu")).resolves.toEqual({
      type: "main_menu",
      confidence: "high"
    });
    await expect(parseIntent("quit")).resolves.toEqual({
      type: "session_exit",
      confidence: "high"
    });
    await expect(parseIntent("exit")).resolves.toEqual({
      type: "session_exit",
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

  it("classifies explicit taste profile update requests", async () => {
    await expect(parseIntent("update my taste profile")).resolves.toEqual({
      type: "taste_profile_update",
      confidence: "high"
    });
    await expect(parseIntent("refresh taste.md")).resolves.toEqual({
      type: "taste_profile_update",
      confidence: "high"
    });
  });

  it("classifies explicit session memory update requests", async () => {
    await expect(parseIntent("summarize this session")).resolves.toEqual({
      type: "session_memory_update",
      confidence: "high"
    });
    await expect(parseIntent("update memory")).resolves.toEqual({
      type: "session_memory_update",
      confidence: "high"
    });
  });
});
