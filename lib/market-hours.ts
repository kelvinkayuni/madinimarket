export const MARKET_TIME_ZONE = "Africa/Dar_es_Salaam";

export type MarketHoursSchedule = {
  openDays: number[];
  openTime: string;
  closeTime: string;
  updatedAt: string | null;
};

const weekdayNumbers: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const marketTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: MARKET_TIME_ZONE,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function localParts(date: Date) {
  const parts = Object.fromEntries(marketTimeFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  const weekday = weekdayNumbers[parts.weekday];
  if (weekday === undefined) throw new Error("Could not determine the Tanzania weekday.");
  return {
    weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function minutesOf(time: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) throw new Error("Market hours must use 24-hour HH:mm times.");
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isMarketOpenAt(schedule: MarketHoursSchedule, at = new Date()) {
  const { weekday, minutes } = localParts(at);
  const open = minutesOf(schedule.openTime);
  const close = minutesOf(schedule.closeTime);
  const days = new Set(schedule.openDays);

  if (open === close) return days.has(weekday);
  if (open < close) return days.has(weekday) && minutes >= open && minutes < close;
  if (minutes >= open) return days.has(weekday);
  return minutes < close && days.has((weekday + 6) % 7);
}

function localDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MARKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function dateAtMarketTime(year: number, month: number, day: number, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = new Intl.DateTimeFormat("en-GB", {
      timeZone: MARKET_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(candidate));
    const values = Object.fromEntries(actual.map((part) => [part.type, part.value]));
    const represented = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
    );
    candidate += target - represented;
  }
  return new Date(candidate);
}

export function getNextMarketOpening(schedule: MarketHoursSchedule, at = new Date()) {
  if (isMarketOpenAt(schedule, at)) return null;
  const { year, month, day } = localDate(at);
  const startOfLocalDay = Date.UTC(year, month - 1, day);
  const sortedDays = new Set(schedule.openDays);

  for (let offset = 0; offset <= 7; offset += 1) {
    const dayDate = new Date(startOfLocalDay + offset * 86_400_000);
    if (!sortedDays.has(dayDate.getUTCDay())) continue;
    const candidate = dateAtMarketTime(
      dayDate.getUTCFullYear(),
      dayDate.getUTCMonth() + 1,
      dayDate.getUTCDate(),
      schedule.openTime,
    );
    if (candidate.getTime() > at.getTime()) return candidate.toISOString();
  }
  return null;
}
