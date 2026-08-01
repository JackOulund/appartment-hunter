import type { Language, RankedListing, SearchPreferences } from "../../domain/entities.js";
import { formatDate } from "../../utils/dates.js";

const LOCALE: Record<Language, string> = { en: "en-GB", sv: "sv-SE" };

function money(amount: number, currency: string, language: Language): string {
  return `${amount.toLocaleString(LOCALE[language])} ${currency}`;
}

export function buildBatchIntro(language: Language, isFirstBatch: boolean): string {
  if (language === "sv") {
    return isFirstBatch
      ? "Jag hittade tre starka matchningar. Reagera 👍 om du gillar en och 👎 om den inte är relevant. Öppna lägenheten för att se alla bilder och detaljer."
      : "Här kommer tre till. Reagera 👍 eller 👎 på varje lägenhet.";
  }
  return isFirstBatch
    ? "I found three strong matches. React 👍 if you like one and 👎 if it is not relevant. Open the apartment to view all photos and details."
    : "Here are three more. React 👍 or 👎 on each apartment.";
}

/**
 * Summary text for one apartment. Every number here comes from the listing or
 * the deterministic score — the LLM may rephrase but never supplies facts.
 */
export function buildListingSummary(
  ranked: RankedListing,
  position: number,
  total: number,
  language: Language,
): string {
  const { listing } = ranked;
  const lines: string[] = [];

  lines.push(`${position} of ${total} — ${listing.title}`);
  lines.push("");
  lines.push(`${money(listing.monthlyRent, listing.currency, language)}/month`);

  const specs: string[] = [];
  if (listing.rooms !== null) {
    specs.push(language === "sv" ? `${listing.rooms} rum` : `${listing.rooms} room${listing.rooms === 1 ? "" : "s"}`);
  }
  if (listing.sizeSquareMeters !== null) specs.push(`${listing.sizeSquareMeters} m²`);
  if (specs.length > 0) lines.push(specs.join(" · "));

  if (listing.availableFrom) {
    lines.push(
      language === "sv"
        ? `Ledig ${formatDate(listing.availableFrom, LOCALE.sv)}`
        : `Available ${formatDate(listing.availableFrom, LOCALE.en)}`,
    );
  }
  if (ranked.commuteMinutes !== null) {
    lines.push(
      language === "sv"
        ? `${ranked.commuteMinutes} minuter till campus`
        : `${ranked.commuteMinutes} minutes to campus`,
    );
  }

  const why = ranked.reasons
    .filter((reason) => reason.code === "budget" || reason.code === "move_in" || reason.code === "furnished")
    .slice(0, 2)
    .map((reason) => reason.label);
  if (why.length > 0) {
    lines.push("");
    lines.push(`${language === "sv" ? "Varför den matchar" : "Why it matches"}: ${why.join(". ")}.`);
  }

  if (language === "sv") {
    // Localise the counter prefix without rebuilding the whole block.
    lines[0] = `${position} av ${total} — ${listing.title}`;
  }
  return lines.join("\n");
}

export interface ListingCard {
  title: string;
  subtitle: string;
  button: string;
}

/**
 * The app card that opens the inspect view. Every value here is a fact from the
 * listing or the deterministic score — the card is the first thing the user sees,
 * so nothing on it may be phrased by the model.
 */
export function buildListingCard(
  ranked: RankedListing,
  position: number,
  total: number,
  language: Language,
): ListingCard {
  const { listing } = ranked;
  const facts: string[] = [`${money(listing.monthlyRent, listing.currency, language)}/${language === "sv" ? "mån" : "month"}`];

  if (listing.rooms !== null) {
    facts.push(
      language === "sv"
        ? `${listing.rooms} rum`
        : `${listing.rooms} room${listing.rooms === 1 ? "" : "s"}`,
    );
  }
  if (listing.sizeSquareMeters !== null) facts.push(`${listing.sizeSquareMeters} m²`);
  if (ranked.commuteMinutes !== null) {
    facts.push(
      language === "sv"
        ? `${ranked.commuteMinutes} min till campus`
        : `${ranked.commuteMinutes} min to campus`,
    );
  }

  return {
    title: `${position}/${total} · ${listing.title}`,
    subtitle: facts.join(" · "),
    button: language === "sv" ? "Visa" : "View",
  };
}

/**
 * Sent after the user opened the inspect view and closed it without deciding.
 * A nudge only: it changes nothing, and it names the reply that would.
 */
export function buildInspectFollowUp(
  listingTitle: string,
  position: number,
  language: Language,
): string {
  return language === "sv"
    ? `Du tittade på ${listingTitle} men bestämde dig inte. Vill du att jag förbereder ett meddelande till hyresvärden? Svara KONTAKTA ${position}, eller strunta i det här om den inte passade.`
    : `You had a look at ${listingTitle} but didn't decide. Want me to prepare a message to the landlord? Reply CONTACT ${position}, or ignore this if it wasn't right.`;
}

export function buildBatchControlMessage(language: Language): string {
  return language === "sv"
    ? "Vill du se tre till? Reagera 👍 för fler eller 👎 för att pausa sökningen."
    : "Would you like three more? React 👍 for another batch or 👎 to stop searching.";
}

export function buildPreferenceSummary(
  preferences: SearchPreferences,
  universityName: string,
  language: Language,
): string {
  const lines: string[] = [];
  const l = language;

  lines.push(l === "sv" ? "Jag söker efter:" : "I'll search for:");
  lines.push("");
  if (preferences.city) lines.push(preferences.city);
  if (preferences.maximumMonthlyRent !== null) {
    lines.push(
      l === "sv"
        ? `Max ${money(preferences.maximumMonthlyRent, preferences.currency, l)}/månad`
        : `Maximum ${money(preferences.maximumMonthlyRent, preferences.currency, l)}/month`,
    );
  }
  if (preferences.preferredMoveInDate) {
    lines.push(
      l === "sv"
        ? `Inflyttning omkring ${formatDate(preferences.preferredMoveInDate, LOCALE.sv)}`
        : `Move-in around ${formatDate(preferences.preferredMoveInDate, LOCALE.en)}`,
    );
  }
  if (preferences.minimumRentalMonths !== null) {
    lines.push(
      l === "sv"
        ? `Minst ${preferences.minimumRentalMonths} månader`
        : `At least ${preferences.minimumRentalMonths} months`,
    );
  }
  if (preferences.maxCommuteMinutes !== null) {
    lines.push(
      l === "sv"
        ? `Max ${preferences.maxCommuteMinutes} minuter från campus`
        : `Maximum ${preferences.maxCommuteMinutes} minutes from campus`,
    );
  }
  if (preferences.minimumRooms !== null) {
    lines.push(
      l === "sv"
        ? `${preferences.minimumRooms} rum eller större`
        : `${preferences.minimumRooms} room${preferences.minimumRooms === 1 ? "" : "s"} or larger`,
    );
  }
  if (preferences.furnishedPreference !== "no_preference") {
    const furnished = preferences.furnishedPreference === "furnished";
    lines.push(
      l === "sv"
        ? furnished ? "Möblerad föredras" : "Omöblerad föredras"
        : furnished ? "Furnished preferred" : "Unfurnished preferred",
    );
  }

  lines.push("");
  lines.push(
    l === "sv"
      ? "Svara SÖK för att fortsätta, eller berätta vad du vill ändra."
      : "Reply SEARCH to continue, or tell me what to change.",
  );
  return `${universityName ? `${universityName}\n\n` : ""}${lines.join("\n")}`;
}

export function buildCongratulations(universityName: string, language: Language): string {
  return language === "sv"
    ? `Grattis! Jag kan hjälpa dig hitta boende nära ${universityName}. Vad är den högsta månadshyran du är bekväm med?`
    : `Congratulations! I can help you find housing close to ${universityName}. What is the highest monthly rent you are comfortable with?`;
}

export const QUESTION_PROMPTS: Record<string, Record<Language, string>> = {
  maximumMonthlyRent: {
    en: "What is the highest monthly rent you are comfortable with?",
    sv: "Vad är den högsta månadshyran du är bekväm med?",
  },
  preferredMoveInDate: {
    en: "When would you like to move in?",
    sv: "När vill du flytta in?",
  },
  minimumRentalMonths: {
    en: "How many months do you need the apartment for, at minimum?",
    sv: "Hur många månader behöver du lägenheten som minst?",
  },
  maxCommuteMinutes: {
    en: "What is the longest commute to campus you would accept, in minutes?",
    sv: "Hur lång restid till campus accepterar du som mest, i minuter?",
  },
  minimumRooms: {
    en: "How many rooms do you need at minimum?",
    sv: "Hur många rum behöver du som minst?",
  },
  furnishedPreference: {
    en: "Do you want it furnished, unfurnished, or does it not matter?",
    sv: "Vill du ha möblerat, omöblerat, eller spelar det ingen roll?",
  },
};

export function buildCampusQuestion(
  universityName: string,
  campuses: { id: string; name: string }[],
  language: Language,
): string {
  const options = campuses.map((campus, index) => `${index + 1}. ${campus.name}`).join("\n");
  return language === "sv"
    ? `${universityName} har flera campus. Vilket ska du studera på?\n\n${options}`
    : `${universityName} has several campuses. Which one will you attend?\n\n${options}`;
}
