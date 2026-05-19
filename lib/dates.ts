export const DEFAULT_TIME_ZONE = "Asia/Damascus";

export function todayKey(
  timeZone = DEFAULT_TIME_ZONE,
  date = new Date(),
): string {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function dateToDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dateKeyToDate(dateKey: string): Date {
  const [year, month, day] = parseDateKey(dateKey);

  return new Date(Date.UTC(year, month - 1, day));
}

export function monthKeyFromDateKey(dateKey: string): string {
  assertDateKey(dateKey);

  return dateKey.slice(0, 7);
}

export function monthRange(monthKey: string): { start: Date; end: Date } {
  const [year, month] = parseMonthKey(monthKey);

  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

export function isDateKeyInMonth(dateKey: string, monthKey: string): boolean {
  assertDateKey(dateKey);
  parseMonthKey(monthKey);

  return dateKey.startsWith(`${monthKey}-`);
}

function parseDateKey(dateKey: string): [number, number, number] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }

  const [year, month, day] = dateKey.split("-").map(Number);

  return [year, month, day];
}

function parseMonthKey(monthKey: string): [number, number] {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error(`Invalid month key: ${monthKey}`);
  }

  const [year, month] = monthKey.split("-").map(Number);

  return [year, month];
}

function assertDateKey(dateKey: string) {
  parseDateKey(dateKey);
}
