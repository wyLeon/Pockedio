import type { PockedioConfig, ScheduledDjProgramConfig } from "../config/schema.js";

export type ScheduledDjKind = "morning" | "evening";

export function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

export function isMorningDjTime(date: Date, config?: PockedioConfig): boolean {
  return isScheduledDjTime(date, getScheduledDjConfig("morning", config));
}

export function isEveningDjTime(date: Date, config?: PockedioConfig): boolean {
  return isScheduledDjTime(date, getScheduledDjConfig("evening", config));
}

export function isMorningDjPrepareTime(date: Date, config?: PockedioConfig): boolean {
  return isScheduledDjPrepareTime(date, getScheduledDjConfig("morning", config));
}

export function isEveningDjPrepareTime(date: Date, config?: PockedioConfig): boolean {
  return isScheduledDjPrepareTime(date, getScheduledDjConfig("evening", config));
}

export function shouldPromptMoodCheck(lastPromptAt: Date | null, now: Date): boolean {
  if (!lastPromptAt) {
    return true;
  }
  return now.getTime() - lastPromptAt.getTime() >= 60 * 60 * 1000;
}

export function scheduledJobKey(kind: ScheduledDjKind, date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${kind}`;
}

export function scheduledPreparationJobKey(kind: ScheduledDjKind, date: Date): string {
  return `${scheduledJobKey(kind, date)}-prepare`;
}

export function getScheduledDjTargetPlayTime(kind: ScheduledDjKind, date: Date, config?: PockedioConfig): Date {
  return dateAtLocalTime(date, getScheduledDjConfig(kind, config).playTime);
}

export function formatLocalDateTime(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absOffset / 60);
  const offsetRemainingMinutes = absOffset % 60;
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    "T",
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${date.getMilliseconds().toString().padStart(3, "0")}`,
    `${sign}${pad(offsetHours)}:${pad(offsetRemainingMinutes)}`
  ].join("");
}

function isScheduledDjTime(date: Date, schedule: ScheduledDjProgramConfig): boolean {
  if (!schedule.enabled || !isWeekday(date)) {
    return false;
  }
  const target = dateAtLocalTime(date, schedule.playTime);
  return date.getHours() === target.getHours() && date.getMinutes() === target.getMinutes();
}

function isScheduledDjPrepareTime(date: Date, schedule: ScheduledDjProgramConfig): boolean {
  if (!schedule.enabled || !isWeekday(date)) {
    return false;
  }
  const prepareAt = new Date(dateAtLocalTime(date, schedule.playTime).getTime() - schedule.prepareMinutesBefore * 60_000);
  return date.getHours() === prepareAt.getHours() && date.getMinutes() === prepareAt.getMinutes();
}

function getScheduledDjConfig(kind: ScheduledDjKind, config?: PockedioConfig): ScheduledDjProgramConfig {
  return config?.dj.schedule[kind] ?? {
    enabled: true,
    playTime: kind === "morning" ? "08:45" : "17:00",
    prepareMinutesBefore: 10
  };
}

function dateAtLocalTime(date: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, 0, 0);
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
