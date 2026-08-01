import type { Campus, ContactCapability, HousingListing, SearchPreferences } from "../../domain/entities.js";

export interface HousingSearchInput {
  preferences: SearchPreferences;
  campus: Campus | null;
  /** Provider-side cap; ranking still happens in our own domain layer. */
  limit?: number;
}

export interface HousingSearchResult {
  listings: HousingListing[];
  provider: string;
  fetchedAt: Date;
}

export interface HousingContactCapability {
  capability: ContactCapability;
  /** Present when the capability is `email`. */
  recipientEmail?: string;
  /** Present when the capability is `manual_handoff`. */
  manualUrl?: string;
  note?: string;
}

export interface HousingContactInput {
  listing: HousingListing;
  message: string;
  applicant: { fullName: string; email: string; phone: string };
  idempotencyKey: string;
}

export interface HousingContactResult {
  status: "sent" | "failed" | "manual_required";
  externalMessageId?: string;
  failureReason?: string;
  manualUrl?: string;
}

export interface HousingProvider {
  readonly name: string;
  search(input: HousingSearchInput): Promise<HousingSearchResult>;
  getListing(id: string): Promise<HousingListing | null>;
  getContactCapability(listing: HousingListing): Promise<HousingContactCapability>;
  contact?(input: HousingContactInput): Promise<HousingContactResult>;
}
