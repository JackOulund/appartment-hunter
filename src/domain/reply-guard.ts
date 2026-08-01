export interface GuardResult {
  ok: boolean;
  text: string | null;
  reason: "too_long" | "unseen_number" | "empty" | null;
}

/** Digit runs this short are conversational ("2nd", "45 min"), never a quoted fact. */
const SUBSTANTIAL_RUN_LENGTH = 3;

/** [label](url) -> label; kept before the bare-url strip removes the url form. */
function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g, "$1");
}

function stripEmphasisMarkers(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1");
}

function stripHeadingPrefixes(text: string): string {
  return text.replace(/^#{1,6}\s+/gm, "");
}

function stripBareUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "");
}

function cleanDraft(draft: string): string {
  let text = stripMarkdownLinks(draft);
  text = stripEmphasisMarkers(text);
  text = stripHeadingPrefixes(text);
  text = stripBareUrls(text);
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Removes digit-group separators (spaces, non-breaking spaces, commas, dots) that sit
 * between digits, so "9 000", "9,000", "9.000" and "9000" all normalise the same way.
 */
function collapseDigitSeparators(text: string): string {
  return text.replace(/(?<=\d)[\s ,.](?=\d)/g, "");
}

/** Extracts every normalised digit run, expanding "9k"/"9K" shorthand to "9000" first. */
function extractDigitRuns(text: string): string[] {
  const expanded = text.replace(/(\d+)[kK]\b/g, (_, digits: string) => `${digits}000`);
  const collapsed = collapseDigitSeparators(expanded);
  return collapsed.match(/\d+/g) ?? [];
}

function buildAllowedNumbers(facts: string[]): Set<string> {
  const allowed = new Set<string>();
  for (const fact of facts) {
    for (const run of extractDigitRuns(fact)) {
      allowed.add(run);
    }
  }
  return allowed;
}

/**
 * Guards an LLM-drafted iMessage reply before it can be sent: every substantive number
 * must be grounded in facts computed by deterministic code, so a hallucinated rent or
 * date can never reach the user. Short digit runs (positions, minute counts) pass freely
 * so ordinary conversational replies don't degrade to a template.
 */
export function guardReply(draft: string, facts: string[], maxLength = 350): GuardResult {
  const cleaned = cleanDraft(draft);

  if (!cleaned) {
    return { ok: false, text: null, reason: "empty" };
  }

  if (cleaned.length > maxLength) {
    return { ok: false, text: null, reason: "too_long" };
  }

  const allowedNumbers = buildAllowedNumbers(facts);
  const draftRuns = extractDigitRuns(cleaned);
  const hasUngroundedNumber = draftRuns.some(
    (run) => run.length >= SUBSTANTIAL_RUN_LENGTH && !allowedNumbers.has(run),
  );
  if (hasUngroundedNumber) {
    return { ok: false, text: null, reason: "unseen_number" };
  }

  return { ok: true, text: cleaned, reason: null };
}
