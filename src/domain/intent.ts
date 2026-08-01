import type { Command, PreferenceField, PreferenceValue } from "./command-parser.js";
import { furnishedPreferenceSchema } from "./entities.js";
import type { ProposedCommand, TurnDecision } from "../integrations/llm/turn-schema.js";

/** Kinds whose Command has its own deterministic handler and reply. */
export const ACTION_COMMAND_KINDS = [
  "like", "reject", "more", "stop", "contact", "contact_all_liked",
  "search", "cancel", "change_preference", "start_over",
  "pause", "resume", "got_apartment",
] as const;

const MOVE_IN_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validPreferenceValue(field: PreferenceField, value: NonNullable<ProposedCommand["value"]>): PreferenceValue | null {
  switch (field) {
    case "maximumMonthlyRent":
      return typeof value === "number" && value > 0 ? value : null;
    case "maxCommuteMinutes":
      return typeof value === "number" && value >= 1 && value <= 179 ? value : null;
    case "minimumRentalMonths":
      return typeof value === "number" && value >= 1 && value <= 60 ? value : null;
    case "minimumRooms":
      return typeof value === "number" && value > 0 && value <= 10 ? value : null;
    case "minimumSizeSquareMeters":
      return typeof value === "number" && value >= 1 && value <= 499 ? value : null;
    case "preferredMoveInDate":
      return typeof value === "string" && MOVE_IN_DATE_PATTERN.test(value) ? value : null;
    case "furnishedPreference": {
      const parsed = furnishedPreferenceSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    }
  }
}

/**
 * Maps the model's proposal onto the deterministic Command union. This is the
 * only place an LLM output can become a Command, and the union it maps into has
 * no confirm_send or delete_data member — those can only be reached by the user
 * typing the exact text the deterministic parser matches.
 */
export function toCommand(decision: TurnDecision, minConfidence = 0.6): Command | null {
  if (decision.confidence < minConfidence) return null;

  const { command } = decision;
  switch (command.kind) {
    case "chat":
    case "unknown":
      return null;

    case "like":
    case "reject": {
      if (command.positions.length !== 1) return null;
      const position = command.positions[0];
      if (position === undefined) return null;
      return { kind: command.kind, position };
    }

    case "contact": {
      if (command.positions.length === 0) return null;
      return { kind: "contact", positions: [...new Set(command.positions)].sort((a, b) => a - b) };
    }

    case "change_preference": {
      if (command.field === null || command.value === null) return null;
      const value = validPreferenceValue(command.field, command.value);
      if (value === null) return null;
      return { kind: "change_preference", field: command.field, value };
    }

    case "more":
    case "stop":
    case "contact_all_liked":
    case "search":
    case "cancel":
    case "start_over":
    case "pause":
    case "resume":
    case "got_apartment":
    case "help":
      return { kind: command.kind };
  }
}

/**
 * An action command runs its own deterministic reply; a stray LLM-drafted
 * reply alongside it is dropped, not the command. Only chat/unknown — where
 * there is no command — surface the model's own reply text.
 */
export function replyFor(decision: TurnDecision, command: Command | null): string | null {
  if (command !== null && (ACTION_COMMAND_KINDS as readonly string[]).includes(command.kind)) return null;
  return decision.reply;
}
