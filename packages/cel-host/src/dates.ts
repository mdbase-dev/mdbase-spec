// Date-string helpers for the mdbase CEL profile (Chapter 10, "Temporal Values").
// Dates are RFC 3339 full-date strings; timestamps are JS Date values.

const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class DateValueError extends Error {}

interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export function parseFullDate(value: unknown): CivilDate {
  if (typeof value !== "string") {
    throw new DateValueError(`expected an RFC 3339 full-date string, got ${typeof value}`);
  }
  const match = FULL_DATE.exec(value);
  if (!match) {
    throw new DateValueError(`"${value}" is not an RFC 3339 full-date`);
  }
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > daysInMonth(date.year, date.month)) {
    throw new DateValueError(`"${value}" is not a valid calendar date`);
  }
  return date;
}

export function formatFullDate(date: CivilDate): string {
  return `${String(date.year).padStart(4, "0")}-${pad(date.month)}-${pad(date.day)}`;
}

export function addDays(value: string, days: number): string {
  const date = parseFullDate(value);
  return fromEpochDay(toEpochDay(date) + days);
}

export function addMonths(value: string, months: number): string {
  const date = parseFullDate(value);
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return formatFullDate({ year, month, day: Math.min(date.day, daysInMonth(year, month)) });
}

export function addYears(value: string, years: number): string {
  return addMonths(value, years * 12);
}

export function daysUntil(value: string, other: string): number {
  return toEpochDay(parseFullDate(other)) - toEpochDay(parseFullDate(value));
}

export function isoWeekday(value: string): number {
  const weekday = new Date(toEpochDay(parseFullDate(value)) * 86_400_000).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Calendar date of an instant in an IANA timezone. */
export function dateOfInstant(instant: Date, timezone: string): string {
  const parts = zonedParts(instant, timezone);
  return formatFullDate({ year: parts.year, month: parts.month, day: parts.day });
}

/** First instant of a calendar date in an IANA timezone. */
export function startOfDay(value: string, timezone: string): Date {
  const date = parseFullDate(value);
  const utcMidnight = Date.UTC(date.year, date.month - 1, date.day);
  // Iterate because the offset at local midnight can differ from the offset at
  // the UTC guess, for example across a daylight-saving transition.
  let guess = utcMidnight;
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(new Date(guess), timezone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const offset = asUtc - guess;
    const next = utcMidnight - offset;
    if (next === guess) {
      break;
    }
    guess = next;
  }
  return new Date(guess);
}

function zonedParts(instant: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") {
      parts[part.type] = Number(part.value);
    }
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

function toEpochDay(date: CivilDate): number {
  return Date.UTC(date.year, date.month - 1, date.day) / 86_400_000;
}

function fromEpochDay(day: number): string {
  const date = new Date(day * 86_400_000);
  return formatFullDate({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  });
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
