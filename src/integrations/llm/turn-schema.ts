import { z } from "zod";
import { extractedPreferencesSchema } from "./llm-provider.js";

const preferenceFieldSchema = z.enum([
  "maximumMonthlyRent",
  "preferredMoveInDate",
  "minimumRentalMonths",
  "maxCommuteMinutes",
  "minimumRooms",
  "minimumSizeSquareMeters",
  "furnishedPreference",
]);

export const proposedCommandSchema = z.object({
  // confirm_send and delete_data are deliberately absent — the model
  // has no token with which to ask for either.
  kind: z.enum([
    "like", "reject", "more", "stop", "contact", "contact_all_liked",
    "search", "cancel", "change_preference", "start_over",
    "pause", "resume", "got_apartment", "help", "chat", "unknown",
  ]),
  positions: z.array(z.number().int().min(1).max(3)).default([]),
  field: preferenceFieldSchema.nullable().default(null),
  value: z.union([z.number(), z.string()]).nullable().default(null),
});
export type ProposedCommand = z.infer<typeof proposedCommandSchema>;

export const turnDecisionSchema = z.object({
  command: proposedCommandSchema,
  preferences: extractedPreferencesSchema,
  reply: z.string().max(320).nullable().default(null),
  confidence: z.number().min(0).max(1),
});
export type TurnDecision = z.infer<typeof turnDecisionSchema>;
