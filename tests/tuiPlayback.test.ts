import { describe, expect, it } from "vitest";
import {
  renderPlaybackSurface,
  renderTuiDjNoteBlock,
  renderTuiPrompt,
  renderTuiProgress,
  renderTuiReplyBlock,
  renderTuiRow,
  renderTuiSectionLabel,
  renderTuiUserTurn,
  type TuiPlaybackQueueEntry
} from "../src/tui/terminalRenderer.js";
import type { StationTrack } from "../src/station/stationTypes.js";

function track(position: number, title: string, artist: string, rationale = "quiet, focused piano"): StationTrack {
  return {
    position,
    title,
    artist,
    rationale,
    playable: {
      available: true,
      provider: "netease",
      providerTrackId: `${position}`,
      playableUrl: `https://example.com/${position}.mp3`,
      urlType: "mp3",
      durationMs: position === 2 ? 337_000 : undefined
    }
  };
}

function entry(position: number, title: string, artist: string, rationale?: string): TuiPlaybackQueueEntry {
  return {
    dbId: `${position}`,
    track: track(position, title, artist, rationale)
  };
}

describe("terminal playback renderer", () => {
  it("renders reusable terminal rows and section labels with a no-color fallback", () => {
    expect(renderTuiSectionLabel("now playing")).toBe("NOW PLAYING");
    expect(renderTuiRow({ marker: ">", label: "2/5", text: "Blue in Green - Miles Davis", meta: "now" })).toBe("> 2/5  Blue in Green - Miles Davis  now");
    expect(renderTuiProgress({ filled: 6, total: 10 })).toBe("▰▰▰▰▰▰▱▱▱▱");
    expect(renderTuiDjNoteBlock("Mina", "This set opens softly.")).toBe("Mina's note:\nThis set opens softly.");
    expect(renderTuiReplyBlock("Mina", "This song is a live recording.")).toBe("● This song is a live recording.");
    expect(renderTuiPrompt()).toBe("›");
    expect(renderTuiUserTurn("Tell me the song.")).toBe("› Tell me the song.");
  });

  it("renders selected rows as terminal-native background bands when color is enabled", () => {
    const rendered = renderTuiRow(
      { marker: ">", label: "2/5", text: "Blue in Green - Miles Davis", meta: "now", selected: true, accent: "playback" },
      { color: true, width: 64 }
    );

    expect(rendered).toMatch(/\u001b\[[0-9;]*48;5;/);
    expect(rendered).toMatch(/\u001b\[[0-9;]*38;5;/);
    expect(rendered).toContain("▌");
    expect(stripAnsi(rendered).length).toBe(64);
  });

  it("renders DJ note blocks with the same selected header band as playback notes", () => {
    const rendered = renderTuiDjNoteBlock("Mina", "This set opens softly.", { color: true, width: 64 });
    const plain = stripAnsi(rendered);

    expect(rendered).toMatch(/\u001b\[[0-9;]*48;5;/);
    expect(plain).toContain("MINA  DJ note");
    expect(plain).toContain("This set opens softly.");
  });

  it("renders conversational reply blocks as bullet-led prose with hanging wraps", () => {
    const rendered = renderTuiReplyBlock(
      "Mina",
      "This song is a live recording with a quiet emotional center that fits the current set.",
      { color: true, width: 48 }
    );
    const plain = stripAnsi(rendered);

    expect(rendered).toMatch(/\u001b\[[0-9;]*38;5;/);
    expect(plain).toContain("● This song is a live recording with a quiet");
    expect(plain).toContain("\n  emotional center");
    expect(plain).not.toContain("MINA  reply");
  });

  it("renders a unified five-song playback arc with current track and queue", () => {
    const queue = [
      entry(1, "Autumn Leaves", "Bill Evans"),
      entry(2, "Blue in Green", "Miles Davis", "late-night modal jazz, low brightness"),
      entry(3, "My Little Brown Book", "John Coltrane", "adds tenor warmth after trumpet and piano"),
      entry(4, "Skylark", "Ella Fitzgerald"),
      entry(5, "What Are You Doing The Rest Of Your Life?", "Bill Evans")
    ];

    const rendered = renderPlaybackSurface({
      queue,
      currentIndex: 1,
      currentStartedAt: new Date("2026-05-23T10:00:00Z"),
      now: new Date("2026-05-23T10:02:18Z"),
      djDisplayName: "Mina",
      trackNote: "Blue in Green keeps the room slow and reflective.",
      color: true,
      width: 96
    });
    const plain = stripAnsi(rendered);

    expect(plain).toContain("NOW PLAYING");
    expect(plain).toContain("2/5  Blue in Green - Miles Davis");
    expect(plain).not.toContain("Now playing:");
    expect(plain).toContain("[========>...........] 02:18 / 05:37");
    expect(plain).toContain("MINA  DJ note");
    expect(plain).not.toContain("UP NEXT");
    expect(plain).not.toContain("NEXT HANDOFF");
    expect(plain).toContain("QUEUE");
    expect(plain).not.toContain("Queue:");
    expect(plain).toContain("  1. Autumn Leaves - Bill Evans  played");
    expect(plain).toContain("> 2. Blue in Green - Miles Davis  now");
    expect(plain).toContain("  3. My Little Brown Book - John Coltrane  next");
  });
});

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}
