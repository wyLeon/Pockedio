import { spawn } from "node:child_process";
import fs from "node:fs";

const scriptPath = process.argv[2] || "spikes/scripts/apple_calendar_probe.applescript";
const timeoutMs = Number(process.env.POCKEDIO_CALENDAR_TIMEOUT_MS || 20000);
const rawOut = "/tmp/pockedio-apple-calendar-current-day.raw.txt";
const rawErr = "/tmp/pockedio-apple-calendar-error.txt";

const child = spawn("osascript", [scriptPath], { stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
let timedOut = false;

const timer = setTimeout(() => {
  timedOut = true;
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 1000).unref();
}, timeoutMs);

child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

child.on("close", (code, signal) => {
  clearTimeout(timer);
  fs.writeFileSync(rawOut, stdout);
  fs.writeFileSync(rawErr, stderr);

  const eventLines = stdout.split(/\r?\n/).filter(Boolean).length;
  const summary = {
    ok: !timedOut && code === 0,
    timedOut,
    code,
    signal,
    timeoutMs,
    eventLines,
    rawOutputPath: rawOut,
    rawErrorPath: rawErr,
    fieldsRequested: ["calendar name", "summary", "start date", "end date"],
    errorSummary: stderr.split(/\r?\n/).find(Boolean) || null
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.ok ? 0 : 1);
});
