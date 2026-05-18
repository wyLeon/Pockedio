export function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day >= 1 && day <= 5;
}

export function isMorningDjTime(date: Date): boolean {
  return isWeekday(date) && date.getHours() === 8 && date.getMinutes() === 45;
}

export function isEveningDjTime(date: Date): boolean {
  return isWeekday(date) && date.getHours() === 17 && date.getMinutes() === 0;
}

export function shouldPromptMoodCheck(lastPromptAt: Date | null, now: Date): boolean {
  if (!lastPromptAt) {
    return true;
  }
  return now.getTime() - lastPromptAt.getTime() >= 60 * 60 * 1000;
}

export function scheduledJobKey(kind: "morning" | "evening", date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${kind}`;
}
