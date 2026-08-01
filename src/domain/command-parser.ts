import type { FurnishedPreference, Language } from "./entities.js";
import { parseHumanDate, toIsoDate } from "../utils/dates.js";

export type Command =
  | { kind: "like"; position: number }
  | { kind: "reject"; position: number }
  | { kind: "more" }
  | { kind: "stop" }
  | { kind: "contact"; positions: number[] }
  | { kind: "contact_all_liked" }
  | { kind: "search" }
  | { kind: "confirm_send" }
  | { kind: "cancel" }
  | { kind: "change_preference"; field: PreferenceField; value: PreferenceValue }
  | { kind: "start_over" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "delete_data" }
  | { kind: "got_apartment" }
  | { kind: "help" }
  | { kind: "unknown" };

export type PreferenceField =
  | "maximumMonthlyRent"
  | "preferredMoveInDate"
  | "minimumRentalMonths"
  | "maxCommuteMinutes"
  | "minimumRooms"
  | "minimumSizeSquareMeters"
  | "furnishedPreference";

export type PreferenceValue = number | string | FurnishedPreference;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  ett: 1, en: 1, två: 2, tva: 2, tre: 3, fyra: 4, fem: 5,
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** "8 000", "8,000", "8k" and "8000" all mean the same thing. */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[\s,.](?=\d{3}\b)/g, "").replace(/\s/g, "");
  const kMatch = cleaned.match(/^(\d+(?:[.,]\d+)?)k$/i);
  if (kMatch?.[1]) return Math.round(Number(kMatch[1].replace(",", ".")) * 1000);
  const value = Number(cleaned.replace(/[^\d]/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parsePosition(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (NUMBER_WORDS[trimmed]) return NUMBER_WORDS[trimmed];
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 1 && value <= 3 ? value : null;
}

/**
 * Deterministic first pass. Returns `unknown` when it is not confident, and the
 * caller falls back to the LLM — never the other way round.
 */
export function parseCommand(input: string, now: Date = new Date()): Command {
  const text = normalize(input);
  if (!text) return { kind: "unknown" };

  // Irreversible or privacy-critical commands are matched before anything else.
  if (/^(delete my data|radera mina uppgifter|ta bort mina uppgifter|delete data)$/.test(text)) {
    return { kind: "delete_data" };
  }
  if (/^(send)$/i.test(input.trim())) return { kind: "confirm_send" };
  if (/^(cancel|avbryt)$/.test(text)) return { kind: "cancel" };
  if (/^(start over|starta om|börja om|borja om|restart|reset)$/.test(text)) return { kind: "start_over" };
  if (/^(pause|pausa)$/.test(text)) return { kind: "pause" };
  if (/^(resume|fortsätt|fortsatt|continue)$/.test(text)) return { kind: "resume" };
  if (/^(help|hjälp|hjalp|\?)$/.test(text)) return { kind: "help" };
  if (/^(search|sök|sok|go|kör|kor)$/.test(text)) return { kind: "search" };
  if (/^(stop|stopp|sluta|no more|inga fler)$/.test(text)) return { kind: "stop" };
  if (/^(more|show more|fler|visa fler|next|nästa|nasta|another|three more|tre till)$/.test(text)) {
    return { kind: "more" };
  }

  if (/(i got|i found|jag fick|jag har hittat).*(apartment|flat|lägenhet|lagenhet|place|bostad)/.test(text)) {
    return { kind: "got_apartment" };
  }

  if (/^contact all liked$|^kontakta alla$/.test(text)) return { kind: "contact_all_liked" };

  const contact = text.match(/^(?:contact|kontakta)\s+(.+)$/);
  if (contact?.[1]) {
    const positions = contact[1]
      .split(/\s*(?:,|and|och|&)\s*/)
      .map((part) => parsePosition(part))
      .filter((value): value is number => value !== null);
    if (positions.length > 0) return { kind: "contact", positions: [...new Set(positions)].sort() };
  }

  const like = text.match(/^(?:like|gilla|yes to|ja till)\s+(\S+)$/);
  const likePosition = parsePosition(like?.[1]);
  if (likePosition !== null) return { kind: "like", position: likePosition };

  const reject = text.match(/^(?:reject|no|nej|skip|hoppa över|hoppa over|dislike)\s+(\S+)$/);
  const rejectPosition = parsePosition(reject?.[1]);
  if (rejectPosition !== null) return { kind: "reject", position: rejectPosition };

  const change = parsePreferenceChange(text, now);
  if (change) return change;

  return { kind: "unknown" };
}

function parsePreferenceChange(text: string, now: Date): Command | null {
  // Budget: "change budget to 9000", "min budget är 9000", "max 9000 per month"
  const budget = text.match(
    /(?:budget|rent|hyra|max(?:imum)?(?:\s+rent)?)\D{0,20}?(\d[\d\s.,]*k?)/,
  );
  if (budget?.[1] && /(budget|rent|hyra)/.test(text)) {
    const value = parseAmount(budget[1]);
    if (value !== null) {
      return { kind: "change_preference", field: "maximumMonthlyRent", value };
    }
  }

  // Commute: "change commute to 20 minutes", "max 15 min to campus"
  const commute = text.match(/(?:commute|pendling|restid|minutes|minuter|min)\D{0,20}?(\d{1,3})\s*(?:min|minut)/);
  const commuteAlt = text.match(/(\d{1,3})\s*(?:min|minutes|minuter)\b/);
  if ((commute || commuteAlt) && /(commute|pendling|restid|campus|university|universitet)/.test(text)) {
    const raw = commute?.[1] ?? commuteAlt?.[1];
    const value = raw ? Number(raw) : null;
    if (value && value > 0 && value < 180) {
      return { kind: "change_preference", field: "maxCommuteMinutes", value };
    }
  }

  // Duration: "at least 12 months", "minst 6 månader"
  const duration = text.match(/(\d{1,2})\s*(?:months?|månader|manader|mån|man)\b/);
  if (duration?.[1] && /(month|månad|manad|duration|hyresperiod|at least|minst)/.test(text)) {
    const value = Number(duration[1]);
    if (value > 0 && value <= 60) {
      return { kind: "change_preference", field: "minimumRentalMonths", value };
    }
  }

  // Rooms: "at least 2 rooms", "minst 2 rum"
  const rooms = text.match(/(\d(?:[.,]\d)?)\s*(?:rooms?|rum|rok)\b/);
  if (rooms?.[1]) {
    const value = Number(rooms[1].replace(",", "."));
    if (value > 0 && value <= 10) {
      return { kind: "change_preference", field: "minimumRooms", value };
    }
  }

  // Size: "at least 30 m2"
  const size = text.match(/(\d{1,3})\s*(?:m2|m²|sqm|kvm|square meters?|kvadratmeter)/);
  if (size?.[1]) {
    const value = Number(size[1]);
    if (value > 0 && value < 500) {
      return { kind: "change_preference", field: "minimumSizeSquareMeters", value };
    }
  }

  // Furnished preference.
  if (/\b(unfurnished|omöblerad|omoblerad|omöblerat)\b/.test(text)) {
    return { kind: "change_preference", field: "furnishedPreference", value: "unfurnished" satisfies FurnishedPreference };
  }
  if (/\b(furnished|möblerad|moblerad|möblerat)\b/.test(text)) {
    return { kind: "change_preference", field: "furnishedPreference", value: "furnished" satisfies FurnishedPreference };
  }
  if (/\b(no preference|spelar ingen roll|kvittar)\b/.test(text)) {
    return { kind: "change_preference", field: "furnishedPreference", value: "no_preference" satisfies FurnishedPreference };
  }

  // Move-in date.
  if (/(move|flytta|inflytt|from|från|fran|start)/.test(text)) {
    const date = parseHumanDate(text, now);
    if (date) {
      return { kind: "change_preference", field: "preferredMoveInDate", value: toIsoDate(date) };
    }
  }

  return null;
}

/** Very small language sniff — enough to pick a reply template. */
export function detectLanguageHeuristic(text: string): Language {
  const swedishMarkers = [
    "jag", "och", "att", "för", "med", "lägenhet", "hyra", "månad", "tack",
    "hej", "antagen", "universitet", "bostad", "sök", "från", "möblerad",
  ];
  const normalized = normalize(text);
  const hits = swedishMarkers.filter((word) =>
    new RegExp(`(^|\\s)${word}($|\\s|[.,!?])`).test(normalized),
  ).length;
  return hits >= 2 ? "sv" : "en";
}
