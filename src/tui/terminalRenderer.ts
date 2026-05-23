import type { StationTrack } from "../station/stationTypes.js";

export type TuiAccent = "primary" | "playback" | "dj" | "danger" | "dim";

export type TuiRenderOptions = {
  color?: boolean;
  accent?: TuiAccent;
  width?: number;
};

export type TuiRowInput = {
  marker?: string;
  label?: string;
  text: string;
  meta?: string;
  selected?: boolean;
  accent?: TuiAccent;
};

export type TuiPlaybackQueueEntry = {
  dbId: string;
  track: StationTrack;
};

export type RenderPlaybackSurfaceInput = {
  queue: TuiPlaybackQueueEntry[];
  currentIndex: number;
  currentStartedAt?: Date;
  now: Date;
  djDisplayName: string;
  trackNote: string;
  color?: boolean;
  width?: number;
};

export function renderPlaybackSurface(input: RenderPlaybackSurfaceInput): string {
  const current = input.queue[input.currentIndex]?.track;
  if (!current) {
    return "";
  }
  return [
    renderTuiSectionLabel("NOW PLAYING", { accent: "playback", color: input.color }),
    formatNowPlayingLine(current, input.currentStartedAt, input.now, input.queue.length, input.color, input.width),
    "",
    input.color
      ? renderTuiDjNoteHeader(input.djDisplayName, { color: input.color, width: input.width })
      : `${input.djDisplayName}'s note:`,
    input.trackNote,
    formatQueueSnapshot(input.queue, input.currentIndex, input.color, input.width)
  ].filter(Boolean).join("\n");
}

export function renderTuiDjNoteBlock(displayName: string, note: string, options: TuiRenderOptions = {}): string {
  if (!options.color) {
    return [
      `${displayName}'s note:`,
      note
    ].filter(Boolean).join("\n");
  }
  return [
    renderTuiDjNoteHeader(displayName, options),
    note
  ].filter(Boolean).join("\n");
}

export function renderTuiReplyBlock(displayName: string, reply: string, options: TuiRenderOptions = {}): string {
  void displayName;
  return formatBulletedParagraphs(reply, options);
}

export function renderTuiSectionLabel(label: string, options: TuiRenderOptions = {}): string {
  return applyAccent(label.toUpperCase(), options.accent ?? "dj", options.color);
}

export function renderTuiPrompt(options: TuiRenderOptions = {}): string {
  return applyAccent("›", options.accent ?? "primary", options.color, true);
}

export function renderTuiUserTurn(text: string, options: TuiRenderOptions = {}): string {
  if (!options.color) {
    return `› ${text}`;
  }
  return renderTuiRow({ marker: "›", text, selected: true, accent: "dim" }, options);
}

export function renderTuiRow(input: TuiRowInput, options: TuiRenderOptions = {}): string {
  const left = [input.marker, input.label].filter((part) => part !== undefined && part !== "").join(" ");
  const leftSeparator = left.endsWith(":") || left.endsWith(".") ? " " : "  ";
  const main = left ? `${left}${leftSeparator}${input.text}` : input.text;
  const base = input.meta ? `${main}  ${input.meta}` : main;
  return input.selected ? applySelectedRow(base, input.accent ?? options.accent ?? "primary", options) : base;
}

function renderTuiDjNoteHeader(displayName: string, options: TuiRenderOptions = {}): string {
  return renderTuiRow({ label: displayName.toUpperCase(), text: "DJ note", selected: true, accent: "dj" }, options);
}

export function renderTuiProgress(input: { filled: number; total: number }, options: TuiRenderOptions = {}): string {
  const total = Math.max(1, Math.floor(input.total));
  const filled = Math.max(0, Math.min(total, Math.floor(input.filled)));
  return applyAccent(`${"▰".repeat(filled)}${"▱".repeat(total - filled)}`, options.accent ?? "playback", options.color);
}

export function formatPlaybackProgress(startedAt: Date | undefined, now: Date, durationMs: number | null = null): string {
  const seconds = startedAt ? Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1_000)) : 0;
  if (durationMs !== null && Number.isFinite(durationMs) && durationMs > 0) {
    const totalSeconds = Math.max(1, Math.floor(durationMs / 1_000));
    const clampedSeconds = Math.min(seconds, totalSeconds);
    const filled = Math.min(19, Math.floor((clampedSeconds / totalSeconds) * 20));
    return `[${"=".repeat(filled)}>${".".repeat(19 - filled)}] ${formatClockTime(clampedSeconds)} / ${formatClockTime(totalSeconds)}`;
  }

  const filled = Math.min(19, Math.floor(seconds / 30));
  return `[${"=".repeat(filled)}>${".".repeat(19 - filled)}] ${formatClockTime(seconds)} elapsed`;
}

function formatNowPlayingLine(track: StationTrack, startedAt: Date | undefined, now: Date, totalTracks: number, color = false, width?: number): string {
  const positionPrefix = totalTracks > 1 ? `${track.position}/${totalTracks}  ` : "";
  return [
    renderTuiRow({
      label: color ? positionPrefix.trim() : "Now playing:",
      text: color ? `${track.title} - ${track.artist}` : `${positionPrefix}${track.title} - ${track.artist}`,
      selected: true,
      accent: "playback"
    }, { color, width }),
    formatPlaybackProgress(startedAt, now, getTrackDurationMs(track))
  ].join("\n");
}

function formatQueueSnapshot(queue: TuiPlaybackQueueEntry[], currentIndex: number, color = false, width?: number): string {
  if (queue.length <= 1) {
    return "";
  }
  return [
    "",
    renderTuiSectionLabel("QUEUE", { accent: "playback", color }),
    color ? "" : "Queue:",
    ...queue.map((entry, index) => {
      const suffix = entry.track.playable.available ? "" : " (unavailable)";
      const marker = index === currentIndex ? ">" : " ";
      const state = index < currentIndex ? "  played" : index === currentIndex ? "  now" : index === currentIndex + 1 ? "  next" : "";
      return renderTuiRow({
        marker,
        label: `${entry.track.position}.`,
        text: `${entry.track.title} - ${entry.track.artist}${suffix}`,
        meta: state.trim(),
        selected: index === currentIndex || index === currentIndex + 1,
        accent: index === currentIndex ? "playback" : "dim"
      }, { color, width });
    })
  ].join("\n");
}

function formatBulletedParagraphs(value: string, options: TuiRenderOptions): string {
  const paragraphs = value
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
  return paragraphs.map((paragraph) => formatBulletedParagraph(paragraph, options)).join("\n\n");
}

function formatBulletedParagraph(value: string, options: TuiRenderOptions): string {
  const bullet = applyAccent("●", "primary", options.color, true);
  const prefix = `${bullet} `;
  const indent = "  ";
  const width = Math.max(0, options.width ?? 0);
  if (width <= prefix.length + 20) {
    return `${prefix}${value}`;
  }

  const lines = wrapWords(value, width - 2);
  return lines.map((line, index) => `${index === 0 ? prefix : indent}${line}`).join("\n");
}

function wrapWords(value: string, width: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) {
      line = word;
    } else if (`${line} ${word}`.length <= width) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines.length > 0 ? lines : [value];
}

function formatClockTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function applyAccent(value: string, accent: TuiAccent, color = false, bold = false): string {
  if (!color) {
    return value;
  }
  const code = {
    primary: "38;5;151",
    playback: "38;5;116",
    dj: "38;5;179",
    danger: "38;5;174",
    dim: "38;5;242"
  }[accent];
  const prefix = bold ? `\u001b[1;${code}m` : `\u001b[${code}m`;
  return `${prefix}${value}\u001b[0m`;
}

function applySelectedRow(value: string, accent: TuiAccent, options: TuiRenderOptions): string {
  if (!options.color) {
    return value;
  }
  const rail = applyAccent("▌", accent, true, true);
  const width = Math.max(0, options.width ?? 0);
  const plain = `▌ ${value}`;
  const padded = width > 0 ? plain.padEnd(width) : plain;
  const body = padded.slice(1);
  return `${rail}${selectedRowCode(accent)}${body}\u001b[0m`;
}

function selectedRowCode(accent: TuiAccent): string {
  const foreground = {
    primary: "230",
    playback: "231",
    dj: "230",
    danger: "230",
    dim: "253"
  }[accent];
  const background = {
    primary: "22",
    playback: "23",
    dj: "58",
    danger: "88",
    dim: "236"
  }[accent];
  return `\u001b[1;38;5;${foreground};48;5;${background}m`;
}

function getTrackDurationMs(track: StationTrack): number | null {
  return track.playable.available && typeof track.playable.durationMs === "number"
    ? track.playable.durationMs
    : null;
}
