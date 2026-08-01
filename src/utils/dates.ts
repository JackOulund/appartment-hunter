const DAY_MS = 24 * 60 * 60 * 1000;

export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}

export function addMonths(value: Date, months: number): Date {
  const next = new Date(value.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

export function monthsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round(daysBetween(from, to) / 30.44));
}

/** Renewal searches start RENEWAL_LEAD_DAYS before the lease ends. */
export function renewalSearchDate(leaseEndsAt: Date, leadDays: number): Date {
  return addDays(leaseEndsAt, -leadDays);
}

const SWEDISH_MONTHS: Record<string, number> = {
  januari: 0, februari: 1, mars: 2, april: 3, maj: 4, juni: 5,
  juli: 6, augusti: 7, september: 8, oktober: 9, november: 10, december: 11,
};
const ENGLISH_MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/**
 * Understands "20 August", "20 augusti", "2026-08-20" and "20/8". Returns null
 * rather than guessing — the caller asks the user again instead.
 */
export function parseHumanDate(input: string, now: Date): Date | null {
  const text = input.toLowerCase().trim();

  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso?.[1] && iso[2] && iso[3]) {
    return parseIsoDate(`${iso[1]}-${iso[2]}-${iso[3]}`);
  }

  const months = { ...SWEDISH_MONTHS, ...ENGLISH_MONTHS };
  const monthNames = Object.keys(months).join("|");
  const dayMonth = text.match(new RegExp(`(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s+(${monthNames})`));
  const monthDay = text.match(new RegExp(`(${monthNames})\\s+(\\d{1,2})`));
  const match = dayMonth
    ? { day: Number(dayMonth[1]), month: months[dayMonth[2] as string] }
    : monthDay
      ? { day: Number(monthDay[2]), month: months[monthDay[1] as string] }
      : null;

  if (match && match.month !== undefined) {
    const year =
      match.month < now.getUTCMonth() ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
    return new Date(Date.UTC(year, match.month, match.day));
  }

  const numeric = text.match(/\b(\d{1,2})[/.](\d{1,2})\b/);
  if (numeric?.[1] && numeric[2]) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const year = month < now.getUTCMonth() ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
      return new Date(Date.UTC(year, month, day));
    }
  }

  return null;
}

export function formatDate(value: Date | string | null | undefined, locale = "en-GB"): string {
  const date = typeof value === "string" ? parseIsoDate(value) : value;
  if (!date) return "flexible";
  return date.toLocaleDateString(locale, { day: "numeric", month: "long", timeZone: "UTC" });
}
