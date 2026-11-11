import { toNumber, toText } from "./coerce.js";
import { defineOperator, OperatorError, type OperatorDefinition } from "./types.js";
import type { Value } from "../value.js";

// Dates are text: `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm`, with optional seconds
// and a `Z`. The calendar arithmetic is done here, from the year, month and
// day, rather than with the platform's dates, so every runtime agrees and no
// time zone gets involved.

interface DateParts {
  year: number;
  month: number;
  day: number;
  /** Null for a date with no time. */
  time: { hour: number; minute: number; second: number } | null;
  utc: boolean;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(Z)?)?$/;

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const daysInMonth = (year: number, month: number) => [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;

function check(parts: DateParts, text: string): DateParts {
  const { year, month, day, time } = parts;
  const valid =
    month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month) && (!time || (time.hour <= 23 && time.minute <= 59 && time.second <= 59));
  if (!valid) throw new OperatorError(`"${text}" isn't a real date`);
  return parts;
}

function readDate(value: Value): DateParts {
  const text = toText(value).trim();
  const found = DATE.exec(text);
  if (!found) throw new OperatorError(`Expected a date such as 2026-03-04, or 2026-03-04T09:30, but got "${text}"`);
  const [, year, month, day, hour, minute, second, zone] = found;
  return check(
    {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      time: hour === undefined ? null : { hour: Number(hour), minute: Number(minute), second: Number(second ?? 0) },
      utc: zone === "Z",
    },
    text,
  );
}

function writeDate({ year, month, day, time, utc }: DateParts): string {
  if (year < 1 || year > 9999) throw new OperatorError("The date goes outside the years 1 to 9999");
  const date = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  return time ? `${date}T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}${utc ? "Z" : ""}` : date;
}

/** Days since 1970-01-01 in the proleptic Gregorian calendar (Howard Hinnant's days_from_civil). */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The date `days` after 1970-01-01. */
function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365);
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

const secondsOfDay = (parts: DateParts) => (parts.time ? parts.time.hour * 3600 + parts.time.minute * 60 + parts.time.second : 0);

type Unit = "days" | "months" | "years";

function readUnit(value: Value): Unit {
  const unit = toText(value).trim().toLowerCase();
  const plural = unit.endsWith("s") ? unit : `${unit}s`;
  if (plural === "days" || plural === "months" || plural === "years") return plural;
  throw new OperatorError(`The unit must be days, months or years, not "${toText(value)}"`);
}

function readWhole(value: Value): number {
  const number = toNumber(value);
  if (!Number.isInteger(number)) throw new OperatorError(`Expected a whole number but got ${number}`);
  return number;
}

function add(parts: DateParts, amount: number, unit: Unit): DateParts {
  if (unit === "days") return { ...parts, ...civilFromDays(daysFromCivil(parts.year, parts.month, parts.day) + amount) };
  const months = parts.year * 12 + (parts.month - 1) + (unit === "years" ? amount * 12 : amount);
  const year = Math.floor(months / 12);
  const month = months - year * 12 + 1;
  // The 31st plus a month stops at the end of a shorter month.
  return { ...parts, year, month, day: Math.min(parts.day, daysInMonth(year, month)) };
}

/** Whole days, months or years from one date to another, counting toward zero. */
function difference(from: DateParts, to: DateParts, unit: Unit): number {
  if (unit === "days") {
    const seconds = (daysFromCivil(to.year, to.month, to.day) - daysFromCivil(from.year, from.month, from.day)) * 86400 + secondsOfDay(to) - secondsOfDay(from);
    return Math.trunc(seconds / 86400);
  }
  let months = (to.year - from.year) * 12 + (to.month - from.month);
  // A month only counts once its day, and time, has come round again.
  const later = to.day * 86400 + secondsOfDay(to) - (from.day * 86400 + secondsOfDay(from));
  if (months > 0 && later < 0) months--;
  else if (months < 0 && later > 0) months++;
  return unit === "months" ? months : Math.trunc(months / 12);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Longest first, so `MMM` is read before `MM` and `M`.
const TOKENS = ["yyyy", "MMM", "yy", "MM", "dd", "HH", "mm", "ss", "M", "d"] as const;

function format(parts: DateParts, pattern: string): string {
  const time = parts.time ?? { hour: 0, minute: 0, second: 0 };
  const values: Record<(typeof TOKENS)[number], string> = {
    yyyy: pad(parts.year, 4),
    yy: pad(parts.year % 100),
    MMM: MONTHS[parts.month - 1]!,
    MM: pad(parts.month),
    M: String(parts.month),
    dd: pad(parts.day),
    d: String(parts.day),
    HH: pad(time.hour),
    mm: pad(time.minute),
    ss: pad(time.second),
  };
  let out = "";
  for (let i = 0; i < pattern.length; ) {
    const token = TOKENS.find((t) => pattern.startsWith(t, i));
    out += token ? values[token] : pattern[i];
    i += token ? token.length : 1;
  }
  return out;
}

function parse(text: string, pattern: string): DateParts {
  const fail = () => new OperatorError(`"${text}" doesn't match the pattern "${pattern}"`);
  const read: Partial<Record<(typeof TOKENS)[number], number>> = {};
  let at = 0;
  for (let i = 0; i < pattern.length; ) {
    const token = TOKENS.find((t) => pattern.startsWith(t, i));
    if (!token) {
      if (text[at] !== pattern[i]) throw fail();
      at++;
      i++;
      continue;
    }
    if (token === "MMM") {
      const month = MONTHS.findIndex((name) => text.slice(at, at + 3).toLowerCase() === name.toLowerCase());
      if (month < 0) throw fail();
      read.MM = month + 1;
      at += 3;
    } else {
      // Fixed width for doubled tokens; one or two digits for M and d.
      const width = token === "yyyy" ? 4 : token === "M" || token === "d" ? (/^\d\d/.test(text.slice(at)) ? 2 : 1) : 2;
      const digits = text.slice(at, at + width);
      if (!new RegExp(`^\\d{${width}}$`).test(digits)) throw fail();
      read[token === "M" ? "MM" : token === "d" ? "dd" : token] = Number(digits);
      at += width;
    }
    i += token.length;
  }
  if (at !== text.length) throw fail();
  const year = read.yyyy ?? (read.yy !== undefined ? 2000 + read.yy : undefined);
  if (year === undefined || read.MM === undefined || read.dd === undefined) throw new OperatorError(`The pattern "${pattern}" needs a year, a month and a day`);
  const timed = read.HH !== undefined || read.mm !== undefined || read.ss !== undefined;
  return check({ year, month: read.MM, day: read.dd, time: timed ? { hour: read.HH ?? 0, minute: read.mm ?? 0, second: read.ss ?? 0 } : null, utc: false }, text);
}

const PARTS = ["year", "month", "day", "weekday", "hour", "minute", "second"] as const;

function part(parts: DateParts, name: string): number {
  switch (name.trim().toLowerCase()) {
    case "year":
      return parts.year;
    case "month":
      return parts.month;
    case "day":
      return parts.day;
    case "weekday":
      // ISO: Monday is 1 and Sunday 7. 1970-01-01 was a Thursday.
      return ((((daysFromCivil(parts.year, parts.month, parts.day) + 3) % 7) + 7) % 7) + 1;
    case "hour":
      return parts.time?.hour ?? 0;
    case "minute":
      return parts.time?.minute ?? 0;
    case "second":
      return parts.time?.second ?? 0;
  }
  throw new OperatorError(`The part must be one of ${PARTS.join(", ")}, not "${name}"`);
}

function utcToday(): DateParts {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate(), time: null, utc: false };
}

/** Today's date in UTC. Swappable, so tests can fix it. */
let today = utcToday;

export const dateOperators: OperatorDefinition[] = [
  defineOperator({
    kind: "value",
    id: "date.today",
    label: "Today",
    glyph: "now",
    category: "date",
    description: "Today's date, in UTC, such as `2026-03-04`.",
    inputs: { min: 0, max: 0 },
    run: () => writeDate(today()),
  }),
  defineOperator({
    kind: "value",
    id: "date.parse",
    label: "Read date",
    glyph: "rd",
    category: "date",
    description:
      "Reads a date written another way, such as `04/03/2026` with the pattern `dd/MM/yyyy`, as `2026-03-04`. The pattern uses `yyyy`, `yy`, `MMM`, `MM`, `M`, `dd`, `d`, `HH`, `mm` and `ss`; anything else must match exactly.",
    inputs: { min: 2, max: 2, labels: ["text", "pattern"] },
    run: ([text, pattern]) => writeDate(parse(toText(text as Value), toText(pattern as Value))),
  }),
  defineOperator({
    kind: "value",
    id: "date.format",
    label: "Format date",
    glyph: "fmt",
    category: "date",
    description: "Writes a date with a pattern, such as `dd MMM yyyy` for `04 Mar 2026`. The pattern uses `yyyy`, `yy`, `MMM`, `MM`, `M`, `dd`, `d`, `HH`, `mm` and `ss`.",
    inputs: { min: 2, max: 2, labels: ["date", "pattern"] },
    run: ([date, pattern]) => format(readDate(date as Value), toText(pattern as Value)),
  }),
  defineOperator({
    kind: "value",
    id: "date.add",
    label: "Add to date",
    glyph: "+dt",
    category: "date",
    description: "Adds whole days, months or years to a date; a negative amount goes back. The 31st plus a month stops at the end of a shorter month.",
    inputs: { min: 3, max: 3, labels: ["date", "amount", "unit"] },
    run: ([date, amount, unit]) => writeDate(add(readDate(date as Value), readWhole(amount as Value), readUnit(unit as Value))),
  }),
  defineOperator({
    kind: "value",
    id: "date.diff",
    label: "Date difference",
    glyph: "Δdt",
    category: "date",
    description: "Whole days, months or years from one date to another, such as an age in years from a date of birth to today.",
    inputs: { min: 3, max: 3, labels: ["from", "to", "unit"] },
    run: ([from, to, unit]) => difference(readDate(from as Value), readDate(to as Value), readUnit(unit as Value)),
  }),
  defineOperator({
    kind: "value",
    id: "date.part",
    label: "Part of date",
    glyph: "dt.",
    category: "date",
    description: "One part of a date as a number: year, month, day, weekday (Monday is 1), hour, minute or second.",
    inputs: { min: 2, max: 2, labels: ["date", "part"] },
    run: ([date, name]) => part(readDate(date as Value), toText(name as Value)),
  }),
];

/** Fixes what Today gives, for tests. Pass undefined to go back to the real date. */
export function setToday(date: string | undefined): void {
  const fixed = date === undefined ? undefined : readDate(date);
  today = fixed ? () => fixed : utcToday;
}
