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

export type TuiChoiceListItem = {
  label: string;
  meta?: string;
};

export type RenderPlaybackSurfaceInput = {
  queue: TuiPlaybackQueueEntry[];
  currentIndex: number;
  currentStartedAt?: Date;
  now: Date;
  djDisplayName: string;
  trackNote?: string;
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
    input.trackNote
      ? input.color
        ? renderTuiDjNoteHeader(input.djDisplayName, { color: input.color, width: input.width })
        : `${input.djDisplayName}'s note:`
      : "",
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

export function renderTuiPageTitle(label: string, options: TuiRenderOptions = {}): string {
  if (!options.color) {
    return label;
  }
  return applyAccent(label.toUpperCase(), options.accent ?? "primary", options.color, true);
}

export function renderTuiAccentText(value: string, options: TuiRenderOptions = {}): string {
  return applyAccent(value, options.accent ?? "primary", options.color, true);
}

export function renderTuiBulletLine(text: string, options: TuiRenderOptions = {}): string {
  return `${applyAccent("●", options.accent ?? "primary", options.color, true)} ${text}`;
}

export function renderTuiKeyValue(label: string, value: string, labelWidth = 12, options: TuiRenderOptions = {}): string {
  const key = label.padEnd(labelWidth);
  return `${applyAccent(key, options.accent ?? "dj", options.color, true)} ${value}`;
}

export function renderTuiCommandRow(command: string, description: string, commandWidth = 10, options: TuiRenderOptions = {}): string {
  const key = command.padEnd(commandWidth);
  return `${applyAccent(key, options.accent ?? "dj", options.color, true)} ${description}`;
}

export function renderTuiFooter(text: string, options: TuiRenderOptions = {}): string {
  return applyAccent(text, options.accent ?? "dim", options.color);
}

export function renderTuiPrompt(options: TuiRenderOptions = {}): string {
  return applyAccent("›", options.accent ?? "primary", options.color, true);
}

export function renderTuiUserTurn(text: string, options: TuiRenderOptions = {}): string {
  if (!options.color) {
    return `› ${text.trim()}`;
  }
  return renderTuiRow({ marker: "›", text: text.trim(), selected: true, accent: "dim" }, options);
}

export function renderTuiChoiceList(items: TuiChoiceListItem[], selectedIndex = 0, options: TuiRenderOptions = {}): string {
  if (items.length === 0) {
    return "";
  }
  const positionWidth = Math.max(...items.map((_item, index) => `${index + 1}.`.length));
  const rows = items.map((item, index) => {
    const marker = index === selectedIndex ? ">" : " ";
    const position = `${index + 1}.`.padStart(positionWidth);
    const base = `${marker} ${position}  ${item.label}`;
    return { base, meta: item.meta ?? "", selected: index === selectedIndex };
  });
  const metaColumn = Math.max(
    0,
    ...rows.filter((row) => row.meta).map((row) => stringDisplayWidth(row.base) + 2)
  );
  return rows.map((row) => {
    const meta = row.meta
      ? `${" ".repeat(Math.max(2, metaColumn - stringDisplayWidth(row.base)))}${row.meta}`
      : "";
    const value = `${row.base}${meta}`;
    if (row.selected) {
      return applySelectedRow(value, "playback", options);
    }
    if (!options.color) {
      return value;
    }
    const width = Math.max(0, options.width ?? 0);
    const leading = "  ";
    return width > leading.length
      ? `${leading}${fitToDisplayWidth(value, width - leading.length)}`
      : `${leading}${value}`;
  }).join("\n");
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
  const positionWidth = Math.max(...queue.map((entry) => `${entry.track.position}.`.length));
  const rows = queue.map((entry, index) => {
    const suffix = entry.track.playable.available ? "" : " (unavailable)";
    const marker = index === currentIndex ? ">" : " ";
    const state = index < currentIndex ? "played" : index === currentIndex ? "now" : index === currentIndex + 1 ? "next" : "";
    return {
      marker,
      position: `${entry.track.position}.`,
      text: `${entry.track.title} - ${entry.track.artist}${suffix}`,
      state,
      selected: index === currentIndex || index === currentIndex + 1,
      accent: index === currentIndex ? "playback" as const : "dim" as const
    };
  });
  const stateColumn = Math.max(
    0,
    ...rows
      .filter((row) => row.state)
      .map((row) => stringDisplayWidth(formatQueueRowBase(row, positionWidth)) + 2)
  );
  return [
    "",
    renderTuiSectionLabel("QUEUE", { accent: "playback", color }),
    color ? "" : "Queue:",
    ...rows.map((row) => renderQueueRow(row, positionWidth, stateColumn, { color, width }))
  ].join("\n");
}

type QueueRow = {
  marker: string;
  position: string;
  text: string;
  state: string;
  selected: boolean;
  accent: TuiAccent;
};

function renderQueueRow(row: QueueRow, positionWidth: number, stateColumn: number, options: TuiRenderOptions): string {
  const base = formatQueueRowBase(row, positionWidth);
  const state = row.state
    ? `${" ".repeat(Math.max(2, stateColumn - stringDisplayWidth(base)))}${row.state}`
    : "";
  const value = `${base}${state}`;
  if (row.selected) {
    return applySelectedRow(value, row.accent, options);
  }
  if (!options.color) {
    return value;
  }
  const width = Math.max(0, options.width ?? 0);
  const leading = "  ";
  return width > leading.length
    ? `${leading}${fitToDisplayWidth(value, width - leading.length)}`
    : `${leading}${value}`;
}

function formatQueueRowBase(row: Pick<QueueRow, "marker" | "position" | "text">, positionWidth: number): string {
  return `${row.marker} ${row.position.padStart(positionWidth)}  ${row.text}`;
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
  const prefixWidth = stringDisplayWidth(stripAnsi(prefix));
  if (width <= prefixWidth + 20) {
    return `${prefix}${value}`;
  }

  const lines = wrapWords(value, width - prefixWidth);
  return lines.map((line, index) => `${index === 0 ? prefix : indent}${line}`).join("\n");
}

function wrapWords(value: string, width: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line) {
      line = word;
    } else if (stringDisplayWidth(candidate) <= width) {
      line = candidate;
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

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
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
  const body = width > 1 ? fitToDisplayWidth(` ${value}`, width - 1) : width === 1 ? "" : ` ${value}`;
  return `${rail}${selectedRowCode(accent)}${body}\u001b[0m`;
}

function fitToDisplayWidth(value: string, width: number): string {
  if (width <= 0) {
    return value;
  }
  const truncated = truncateToDisplayWidth(value, width);
  const padding = Math.max(0, width - stringDisplayWidth(truncated));
  return `${truncated}${" ".repeat(padding)}`;
}

function truncateToDisplayWidth(value: string, width: number): string {
  let result = "";
  let used = 0;
  for (const char of value) {
    const charWidth = charDisplayWidth(char);
    if (used + charWidth > width) {
      return result;
    }
    result += char;
    used += charWidth;
  }
  return result;
}

function stringDisplayWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    width += charDisplayWidth(char);
  }
  return width;
}

function charDisplayWidth(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;
  if (codePoint === 0) {
    return 0;
  }
  if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) {
    return 0;
  }
  return isWideCodePoint(codePoint) ? 2 : 1;
}

function isWideCodePoint(codePoint: number): boolean {
  return (codePoint >= 0x1100 && codePoint <= 0x115f)
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6);
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
