import { describe, expect, it } from "vitest";
import {
  renderPlaybackSurface,
  renderTuiChoiceList,
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
    expect(renderTuiUserTurn(" Tell me the song. ")).toBe("› Tell me the song.");
  });

  it("renders submitted user turns as selected transcript rows when color is enabled", () => {
    const rendered = renderTuiUserTurn("favorite the first song", { color: true, width: 56 });
    const plain = stripAnsi(rendered);

    expect(rendered).toMatch(/\u001b\[[0-9;]*48;5;/);
    expect(plain).toContain("▌ ›  favorite the first song");
    expect(displayWidth(plain)).toBe(56);
  });

  it("renders selected rows as terminal-native background bands when color is enabled", () => {
    const rendered = renderTuiRow(
      { marker: ">", label: "2/5", text: "Blue in Green - Miles Davis", meta: "now", selected: true, accent: "playback" },
      { color: true, width: 64 }
    );

    expect(rendered).toMatch(/\u001b\[[0-9;]*48;5;/);
    expect(rendered).toMatch(/\u001b\[[0-9;]*38;5;/);
    expect(rendered).toContain("▌");
    expect(displayWidth(stripAnsi(rendered))).toBe(64);
  });

  it("keeps selected CJK rows inside the terminal width to avoid wrapped background bands", () => {
    const rendered = renderTuiRow(
      { marker: ">", label: "4.", text: "遇见 - 孙燕姿", meta: "now", selected: true, accent: "playback" },
      { color: true, width: 32 }
    );
    const plain = stripAnsi(rendered);

    expect(displayWidth(plain)).toBe(32);
    expect(plain).toContain("遇见");
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

  it("keeps conversational replies with CJK names inside the terminal width", () => {
    const rendered = renderTuiReplyBlock(
      "Mina",
      "This is a bossa nova version of \"Fly Me To The Moon\" by the Brazilian-Japanese artist 小野リサ (Lisa Ono). It's from her album *Cheek To Cheek-Jazz Standards from RIO-*. Her take is light and airy.",
      { color: true, width: 120 }
    );
    const plain = stripAnsi(rendered);

    expect(plain).toContain("● This is a bossa nova version");
    expect(plain).toContain("小野リサ");
    for (const line of plain.split("\n")) {
      expect(displayWidth(line)).toBeLessThanOrEqual(120);
    }
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
    expect(plain).toContain("1.  Autumn Leaves - Bill Evans");
    expect(plain).toContain("> 2.  Blue in Green - Miles Davis");
    expect(plain).toContain("3.  My Little Brown Book - John Coltrane");
  });

  it("aligns queue gutters and states across highlighted and CJK rows", () => {
    const rendered = renderPlaybackSurface({
      queue: [
        entry(1, "我们俩", "郭顶"),
        entry(2, "Fly Me To The Moon", "小野リサ"),
        entry(3, "Love Is A Verb", "John Mayer"),
        entry(4, "River Of Tears (Live)", "Eric Clapton")
      ],
      currentIndex: 2,
      currentStartedAt: new Date("2026-05-25T10:00:00Z"),
      now: new Date("2026-05-25T10:00:00Z"),
      djDisplayName: "Mina",
      trackNote: "This keeps the set moving.",
      color: true,
      width: 96
    });
    const queueLines = stripAnsi(rendered)
      .split("\n")
      .filter((line) => /\d+\./.test(line));
    const numberColumns = queueLines.map((line) => {
      const match = /\d+\./.exec(line);
      expect(match).not.toBeNull();
      return displayWidth(line.slice(0, match!.index));
    });
    const stateColumns = ["played", "now", "next"].map((state) => {
      const line = queueLines.find((candidate) => candidate.includes(state));
      expect(line).toBeTruthy();
      return displayWidth(line!.slice(0, line!.indexOf(state)));
    });

    expect(new Set(numberColumns).size).toBe(1);
    expect(new Set(stateColumns).size).toBe(1);
  });

  it("aligns selectable choice rows with CJK labels and metadata", () => {
    const rendered = renderTuiChoiceList([
      { label: "献给永远的 - 大粉乐队", meta: "song" },
      { label: "Build a 5-song station", meta: "vibe" }
    ], 0, { color: true, width: 72 });
    const lines = stripAnsi(rendered).split("\n");
    const numberColumns = lines.map((line) => {
      const match = /\d+\./.exec(line);
      expect(match).not.toBeNull();
      return displayWidth(line.slice(0, match!.index));
    });
    const metaColumns = ["song", "vibe"].map((meta) => {
      const line = lines.find((candidate) => candidate.includes(meta));
      expect(line).toBeTruthy();
      return displayWidth(line!.slice(0, line!.indexOf(meta)));
    });

    expect(new Set(numberColumns).size).toBe(1);
    expect(new Set(metaColumns).size).toBe(1);
  });
});

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    width += codePoint >= 0x2e80 ? 2 : 1;
  }
  return width;
}
