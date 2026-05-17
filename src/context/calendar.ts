import { spawn, type ChildProcess } from "node:child_process";

export type CalendarEvent = {
  calendarName: string;
  title: string;
  start: string;
  end: string;
};

export type CalendarContext =
  | {
      available: true;
      events: CalendarEvent[];
      summary: string;
    }
  | {
      available: false;
      events: [];
      summary: string;
      warning: string;
    };

export type CalendarProcessRunner = (script: string, timeoutMs: number) => Promise<{ stdout: string; stderr: string; timedOut: boolean; code: number | null }>;

const calendarAppleScript = String.raw`
set startOfDay to current date
set time of startOfDay to 0
set endOfDay to startOfDay + (24 * 60 * 60)
set outputLines to {}

tell application "Calendar"
  repeat with cal in calendars
    set eventList to (events of cal whose start date ≥ startOfDay and start date < endOfDay)
    repeat with evt in eventList
      set eventTitle to summary of evt
      set eventStart to start date of evt
      set eventEnd to end date of evt
      set end of outputLines to ((name of cal) & " | " & eventTitle & " | " & (eventStart as text) & " | " & (eventEnd as text))
    end repeat
  end repeat
end tell

set AppleScript's text item delimiters to linefeed
return outputLines as text
`;

export async function readCalendarContext(
  enabled: boolean,
  timeoutMs = 20_000,
  runner: CalendarProcessRunner = runOsaScript
): Promise<CalendarContext> {
  if (!enabled) {
    return unavailableCalendar("Calendar context is disabled.");
  }

  try {
    const result = await runner(calendarAppleScript, timeoutMs);
    if (result.timedOut) {
      return unavailableCalendar("Calendar read timed out.");
    }
    if (result.code !== 0) {
      return unavailableCalendar(result.stderr.trim() || "Calendar read failed.");
    }
    const events = parseCalendarOutput(result.stdout);
    return {
      available: true,
      events,
      summary: summarizeCalendarEvents(events)
    };
  } catch (error) {
    return unavailableCalendar(error instanceof Error ? error.message : String(error));
  }
}

export function parseCalendarOutput(output: string): CalendarEvent[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [calendarName = "", title = "", start = "", end = ""] = line.split(" | ");
      return { calendarName, title, start, end };
    });
}

export function summarizeCalendarEvents(events: CalendarEvent[]): string {
  if (events.length === 0) {
    return "No calendar events found for today.";
  }

  return `Today's calendar has ${events.length} event${events.length === 1 ? "" : "s"}: ${events
    .map((event) => `${event.title} (${event.start})`)
    .join("; ")}.`;
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
    warning
  };
}
