import { describe, expect, it } from "vitest";
import { detectLanguageHeuristic, parseCommand } from "../../src/domain/command-parser.js";

const NOW = new Date("2026-08-01T00:00:00.000Z");

describe("English commands", () => {
  it.each([
    ["more", "more"],
    ["show more", "more"],
    ["stop", "stop"],
    ["pause", "pause"],
    ["resume", "resume"],
    ["start over", "start_over"],
    ["delete my data", "delete_data"],
    ["search", "search"],
    ["help", "help"],
    ["cancel", "cancel"],
  ])("parses %s", (input, kind) => {
    expect(parseCommand(input, NOW).kind).toBe(kind);
  });

  it("parses positional like and reject", () => {
    expect(parseCommand("like 1", NOW)).toEqual({ kind: "like", position: 1 });
    expect(parseCommand("reject 2", NOW)).toEqual({ kind: "reject", position: 2 });
    expect(parseCommand("like two", NOW)).toEqual({ kind: "like", position: 2 });
  });

  it("parses single and multiple contact targets", () => {
    expect(parseCommand("contact 1", NOW)).toEqual({ kind: "contact", positions: [1] });
    expect(parseCommand("contact 1 and 3", NOW)).toEqual({ kind: "contact", positions: [1, 3] });
    expect(parseCommand("contact 2, 3", NOW)).toEqual({ kind: "contact", positions: [2, 3] });
  });

  it("parses contact all liked", () => {
    expect(parseCommand("contact all liked", NOW).kind).toBe("contact_all_liked");
  });

  it("only accepts the exact word SEND as confirmation", () => {
    expect(parseCommand("SEND", NOW).kind).toBe("confirm_send");
    // Casual agreement must never count as confirmation.
    for (const soft of ["okay", "nice", "sounds good", "sure maybe", "yes please", "ok send it"]) {
      expect(parseCommand(soft, NOW).kind).not.toBe("confirm_send");
    }
  });

  it("recognises that the user found a place", () => {
    expect(parseCommand("I got an apartment", NOW).kind).toBe("got_apartment");
  });
});

describe("Swedish commands", () => {
  it.each([
    ["fler", "more"],
    ["visa fler", "more"],
    ["stopp", "stop"],
    ["pausa", "pause"],
    ["fortsätt", "resume"],
    ["börja om", "start_over"],
    ["radera mina uppgifter", "delete_data"],
    ["sök", "search"],
    ["hjälp", "help"],
    ["avbryt", "cancel"],
  ])("parses %s", (input, kind) => {
    expect(parseCommand(input, NOW).kind).toBe(kind);
  });

  it("parses Swedish positional commands", () => {
    expect(parseCommand("gilla 1", NOW)).toEqual({ kind: "like", position: 1 });
    expect(parseCommand("kontakta 2", NOW)).toEqual({ kind: "contact", positions: [2] });
    expect(parseCommand("kontakta 1 och 3", NOW)).toEqual({ kind: "contact", positions: [1, 3] });
  });
});

describe("preference changes", () => {
  it("parses a budget change in several formats", () => {
    for (const input of ["change budget to 9000", "budget 9 000", "my budget is 9000"]) {
      expect(parseCommand(input, NOW)).toEqual({
        kind: "change_preference",
        field: "maximumMonthlyRent",
        value: 9000,
      });
    }
  });

  it("parses a Swedish budget change", () => {
    expect(parseCommand("ändra hyra till 9000", NOW)).toEqual({
      kind: "change_preference",
      field: "maximumMonthlyRent",
      value: 9000,
    });
  });

  it("parses a commute change", () => {
    expect(parseCommand("change commute to 20 minutes", NOW)).toEqual({
      kind: "change_preference",
      field: "maxCommuteMinutes",
      value: 20,
    });
  });

  it("parses room and size requirements", () => {
    expect(parseCommand("at least 2 rooms", NOW)).toEqual({
      kind: "change_preference",
      field: "minimumRooms",
      value: 2,
    });
    expect(parseCommand("at least 30 m2", NOW)).toEqual({
      kind: "change_preference",
      field: "minimumSizeSquareMeters",
      value: 30,
    });
  });

  it("parses furnished preferences in both languages", () => {
    expect(parseCommand("furnished", NOW)).toEqual({
      kind: "change_preference",
      field: "furnishedPreference",
      value: "furnished",
    });
    expect(parseCommand("omöblerad", NOW)).toEqual({
      kind: "change_preference",
      field: "furnishedPreference",
      value: "unfurnished",
    });
  });

  it("parses a move-in date", () => {
    expect(parseCommand("I want to move in 20 August", NOW)).toEqual({
      kind: "change_preference",
      field: "preferredMoveInDate",
      value: "2026-08-20",
    });
  });

  it("returns unknown when nothing matches confidently", () => {
    expect(parseCommand("what do you think about the weather", NOW).kind).toBe("unknown");
    expect(parseCommand("", NOW).kind).toBe("unknown");
  });
});

describe("language detection", () => {
  it("detects Swedish from common markers", () => {
    expect(detectLanguageHeuristic("Hej, jag har blivit antagen till Lunds universitet")).toBe("sv");
  });

  it("defaults to English", () => {
    expect(detectLanguageHeuristic("I got accepted to Lund University")).toBe("en");
  });
});
