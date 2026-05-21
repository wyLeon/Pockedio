import { spawn, type ChildProcess } from "node:child_process";

export type CalendarEvent = {
  calendarName: string;
  title: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
};

export type CalendarReadWindow = "today" | "last7Days" | "last7DaysAndToday";

export type CalendarContext =
  | {
      available: true;
      events: CalendarEvent[];
      summary: string;
      listeningHint: string;
    }
  | {
      available: false;
      events: [];
      summary: string;
      listeningHint: string;
      warning: string;
    };

export type CalendarProcessRunner = (script: string, timeoutMs: number) => Promise<{ stdout: string; stderr: string; timedOut: boolean; code: number | null }>;
export type CalendarPermissionResult = { available: true } | { available: false; warning: string };

const calendarPermissionScript = String.raw`
tell application "Calendar"
  return count of calendars
end tell
`;

function buildCalendarAppleScript(window: CalendarReadWindow): string {
  const windowBounds = calendarWindowBoundsScript(window);
  return String.raw`
set startOfToday to current date
set time of startOfToday to 0
${windowBounds}
set outputLines to {}

tell application "Calendar"
  repeat with cal in calendars
    set eventList to (events of cal whose start date is greater than or equal to startOfWindow and start date is less than endOfWindow)
    repeat with evt in eventList
      set eventTitle to summary of evt
      set eventStart to start date of evt
      set eventEnd to end date of evt
      set end of outputLines to ((name of cal) & " | " & eventTitle & " | " & (eventStart as text) & " | " & (eventEnd as text) & " | false")
    end repeat
  end repeat
end tell

set AppleScript's text item delimiters to linefeed
return outputLines as text
`;
}

export async function readCalendarContext(
  enabled: boolean,
  timeoutMs = 20_000,
  runner: CalendarProcessRunner = runOsaScript,
  window: CalendarReadWindow = "today"
): Promise<CalendarContext> {
  if (!enabled) {
    return unavailableCalendar("Calendar context is disabled.");
  }

  try {
    const result = await runner(buildCalendarAppleScript(window), timeoutMs);
    if (result.timedOut) {
      return unavailableCalendar("Calendar read timed out.");
    }
    if (result.code !== 0) {
      return unavailableCalendar(normalizeCalendarWarning(result.stderr.trim() || "Calendar read failed."));
    }
    const events = parseCalendarOutput(result.stdout);
    return {
      available: true,
      events,
      summary: summarizeCalendarEvents(events, window),
      listeningHint: buildCalendarListeningHint(events, window)
    };
  } catch (error) {
    return unavailableCalendar(normalizeCalendarWarning(error instanceof Error ? error.message : String(error)));
  }
}

export async function requestCalendarPermission(
  timeoutMs = 20_000,
  runner: CalendarProcessRunner = runOsaScript
): Promise<CalendarPermissionResult> {
  try {
    const result = await runner(calendarPermissionScript, timeoutMs);
    if (result.timedOut) {
      return { available: false, warning: "Calendar permission request timed out." };
    }
    if (result.code !== 0) {
      return { available: false, warning: normalizeCalendarWarning(result.stderr.trim() || "Calendar permission request failed.") };
    }
    return { available: true };
  } catch (error) {
    return { available: false, warning: normalizeCalendarWarning(error instanceof Error ? error.message : String(error)) };
  }
}

export function normalizeCalendarWarning(warning: string): string {
  const lower = warning.toLowerCase();
  if (lower.includes("system settings")) {
    return warning;
  }
  if (lower.includes("not authorized") || lower.includes("not permitted") || lower.includes("permission")) {
    return `${warning} Enable Calendar access for your terminal in System Settings > Privacy & Security > Automation or Calendars, then run setup again.`;
  }
  return warning;
}

export function parseCalendarOutput(output: string): CalendarEvent[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [calendarName = "", title = "", startTime = "", endTime = "", allDay = "false"] = line.split(" | ");
      return {
        calendarName,
        title,
        startTime,
        endTime,
        isAllDay: allDay.toLowerCase() === "true"
      };
    });
}

export function summarizeCalendarEvents(events: CalendarEvent[], window: CalendarReadWindow = "today"): string {
  const label = calendarWindowSummaryLabel(window);
  if (events.length === 0) {
    return `No calendar events found for ${label}.`;
  }

  return `Calendar has ${events.length} event${events.length === 1 ? "" : "s"} for ${label}: ${events
    .map((event) => `${event.title} (${event.startTime})`)
    .join("; ")}.`;
}

export function buildCalendarListeningHint(events: CalendarEvent[], window: CalendarReadWindow = "today"): string {
  const label = calendarWindowSummaryLabel(window);
  if (events.length === 0) {
    return `Calendar listening hint for ${label}: no events found, so do not overfit music to calendar pressure.`;
  }

  const eventCount = events.length;
  const titles = events.map((event) => event.title.toLowerCase()).join(" ");
  const hints: string[] = [];
  if (eventCount >= 4) {
    hints.push("busy schedule favors low-friction music, short DJ talk, and steady pacing");
  } else if (eventCount >= 2) {
    hints.push("some scheduled context favors clear transitions and music that does not demand too much attention");
  } else {
    hints.push("light schedule pressure leaves room for a more open listening arc");
  }
  if (/\b(meeting|sync|review|standup|call|interview|planning|1:1|one on one)\b/.test(titles)) {
    hints.push("meeting-heavy context suggests focus before events and decompression after them");
  }
  if (/\b(gym|workout|run|training|yoga|walk)\b/.test(titles)) {
    hints.push("physical-activity context can support momentum, recovery, or warm-up music");
  }
  if (/\b(dinner|date|party|family|friend|social)\b/.test(titles)) {
    hints.push("social context can support warmer, more human selections");
  }
  return `Calendar listening hint for ${label}: ${hints.join("; ")}.`;
}

export function runOsaScript(script: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; timedOut: boolean; code: number | null }> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn("osascript", ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: error.message, timedOut, code: null });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut, code });
    });
  });
}

function unavailableCalendar(warning: string): CalendarContext {
  return {
    available: false,
    events: [],
    summary: "Calendar context unavailable.",
    listeningHint: "Calendar listening hint unavailable.",
    warning
  };
}

function calendarWindowBoundsScript(window: CalendarReadWindow): string {
  if (window === "last7Days") {
    return String.raw`set startOfWindow to startOfToday
set startOfWindow to startOfWindow - (7 * 24 * 60 * 60)
set endOfWindow to current date
set time of endOfWindow to 0`;
  }

  if (window === "last7DaysAndToday") {
    return String.raw`set startOfWindow to startOfToday
set startOfWindow to startOfWindow - (7 * 24 * 60 * 60)
set endOfWindow to startOfToday + (24 * 60 * 60)`;
  }

  return String.raw`set startOfWindow to startOfToday
set endOfWindow to startOfWindow + (24 * 60 * 60)`;
}

function calendarWindowSummaryLabel(window: CalendarReadWindow): string {
  if (window === "last7Days") {
    return "the last 7 days";
  }
  if (window === "last7DaysAndToday") {
    return "the last 7 days and today";
  }
  return "today";
}
