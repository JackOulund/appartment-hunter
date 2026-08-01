import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

/** JSON is stored as text and parsed at the repository boundary. */
const json = (name: string) => text(name);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    linqHandle: text("linq_handle").notNull(),
    fullName: text("full_name"),
    email: text("email"),
    contactPhone: text("contact_phone"),
    preferredLanguage: text("preferred_language").notNull().default("en"),
    acceptedUniversityId: text("accepted_university_id"),
    selectedCampusId: text("selected_campus_id"),
    consentToStoreProfile: integer("consent_to_store_profile", { mode: "boolean" }).notNull().default(false),
    consentToShareContactDetails: integer("consent_to_share_contact_details", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
    deletedAt: text("deleted_at"),
  },
  (table) => [uniqueIndex("users_linq_handle_idx").on(table.linqHandle)],
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    linqChatId: text("linq_chat_id").notNull(),
    currentState: text("current_state").notNull().default("NEW"),
    statePayload: json("state_payload").notNull().default("{}"),
    activeBatchId: text("active_batch_id"),
    lastInboundMessageId: text("last_inbound_message_id"),
    lastOutboundMessageId: text("last_outbound_message_id"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [uniqueIndex("conversations_linq_chat_idx").on(table.linqChatId)],
);

export const searchProfiles = sqliteTable(
  "search_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    city: text("city"),
    preferredAreas: json("preferred_areas").notNull().default("[]"),
    excludedAreas: json("excluded_areas").notNull().default("[]"),
    maximumMonthlyRent: integer("maximum_monthly_rent"),
    currency: text("currency").notNull().default("SEK"),
    preferredMoveInDate: text("preferred_move_in_date"),
    minimumRentalMonths: integer("minimum_rental_months"),
    minimumRooms: real("minimum_rooms"),
    minimumSizeSquareMeters: integer("minimum_size_square_meters"),
    furnishedPreference: text("furnished_preference").notNull().default("no_preference"),
    maxCommuteMinutes: integer("max_commute_minutes"),
    commuteModes: json("commute_modes").notNull().default('["bicycle"]'),
    requiredAmenities: json("required_amenities").notNull().default("[]"),
    preferredAmenities: json("preferred_amenities").notNull().default("[]"),
    freeTextPreferences: text("free_text_preferences"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [index("search_profiles_user_idx").on(table.userId)],
);

export const searchRuns = sqliteTable("search_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  searchProfileId: text("search_profile_id").notNull().references(() => searchProfiles.id),
  provider: text("provider").notNull(),
  status: text("status").notNull().default("pending"),
  resultCount: integer("result_count").notNull().default(0),
  startedAt: text("started_at").notNull().default(now),
  completedAt: text("completed_at"),
  errorMessage: text("error_message"),
});

export const listings = sqliteTable(
  "listings",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    providerListingId: text("provider_listing_id").notNull(),
    canonicalUrl: text("canonical_url"),
    title: text("title").notNull(),
    description: text("description"),
    address: text("address"),
    city: text("city").notNull(),
    area: text("area"),
    latitude: real("latitude"),
    longitude: real("longitude"),
    monthlyRent: integer("monthly_rent").notNull(),
    currency: text("currency").notNull().default("SEK"),
    rooms: real("rooms"),
    sizeSquareMeters: integer("size_square_meters"),
    furnished: integer("furnished", { mode: "boolean" }),
    availableFrom: text("available_from"),
    availableTo: text("available_to"),
    minimumRentalMonths: integer("minimum_rental_months"),
    amenities: json("amenities").notNull().default("[]"),
    imageUrls: json("image_urls").notNull().default("[]"),
    contactCapability: text("contact_capability").notNull().default("manual_handoff"),
    providerMetadata: json("provider_metadata").notNull().default("{}"),
    firstSeenAt: text("first_seen_at").notNull().default(now),
    lastSeenAt: text("last_seen_at").notNull().default(now),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [uniqueIndex("listings_provider_ref_idx").on(table.provider, table.providerListingId)],
);

export const searchResults = sqliteTable(
  "search_results",
  {
    id: text("id").primaryKey(),
    searchRunId: text("search_run_id").notNull().references(() => searchRuns.id),
    listingId: text("listing_id").notNull().references(() => listings.id),
    score: real("score").notNull(),
    scoreBreakdown: json("score_breakdown").notNull().default("{}"),
    rankingPosition: integer("ranking_position").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [index("search_results_run_idx").on(table.searchRunId)],
);

export const listingBatches = sqliteTable(
  "listing_batches",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    searchRunId: text("search_run_id").notNull().references(() => searchRuns.id),
    sequenceNumber: integer("sequence_number").notNull(),
    controlMessageId: text("control_message_id"),
    createdAt: text("created_at").notNull().default(now),
    completedAt: text("completed_at"),
  },
  (table) => [index("listing_batches_user_idx").on(table.userId)],
);

export const listingPresentations = sqliteTable(
  "listing_presentations",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull().references(() => listingBatches.id),
    listingId: text("listing_id").notNull().references(() => listings.id),
    summaryMessageId: text("summary_message_id"),
    mediaMessageId: text("media_message_id"),
    linkMessageId: text("link_message_id"),
    presentationOrder: integer("presentation_order").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    index("listing_presentations_batch_idx").on(table.batchId),
    // Reaction routing looks a listing up by the message the user reacted to.
    index("listing_presentations_summary_msg_idx").on(table.summaryMessageId),
  ],
);

export const listingDecisions = sqliteTable(
  "listing_decisions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    listingId: text("listing_id").notNull().references(() => listings.id),
    batchId: text("batch_id"),
    decision: text("decision").notNull().default("unseen"),
    source: text("source").notNull().default("system"),
    sourceMessageId: text("source_message_id"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [uniqueIndex("listing_decisions_user_listing_idx").on(table.userId, table.listingId)],
);

/**
 * What the user did inside the inspect view. These are observations, never
 * decisions — a decision only ever comes from an explicit tap or reply, and lives
 * in `listing_decisions`.
 */
export const listingViewEvents = sqliteTable(
  "listing_view_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    listingId: text("listing_id").notNull().references(() => listings.id),
    batchId: text("batch_id"),
    event: text("event").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [index("listing_view_events_user_listing_idx").on(table.userId, table.listingId)],
);

export const applications = sqliteTable(
  "applications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    listingId: text("listing_id").notNull().references(() => listings.id),
    draftMessage: text("draft_message").notNull(),
    editedMessage: text("edited_message"),
    status: text("status").notNull().default("draft"),
    confirmationTokenHash: text("confirmation_token_hash"),
    confirmationExpiresAt: text("confirmation_expires_at"),
    confirmedAt: text("confirmed_at"),
    sentAt: text("sent_at"),
    externalMessageId: text("external_message_id"),
    failureReason: text("failure_reason"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [index("applications_user_idx").on(table.userId)],
);

export const leases = sqliteTable(
  "leases",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    listingId: text("listing_id"),
    address: text("address"),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    renewalSearchAt: text("renewal_search_at"),
    renewalReminderSentAt: text("renewal_reminder_sent_at"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [index("leases_renewal_idx").on(table.renewalSearchAt)],
);

export const webhookEvents = sqliteTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    traceId: text("trace_id"),
    status: text("status").notNull().default("received"),
    receivedAt: text("received_at").notNull().default(now),
    processedAt: text("processed_at"),
    failureReason: text("failure_reason"),
  },
  // The uniqueness constraint is what makes at-least-once delivery safe.
  (table) => [uniqueIndex("webhook_events_provider_event_idx").on(table.providerEventId)],
);

/** Guarantees one outbound Linq message per idempotency key, across restarts. */
export const outboundMessages = sqliteTable(
  "outbound_messages",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    conversationId: text("conversation_id"),
    linqChatId: text("linq_chat_id").notNull(),
    kind: text("kind").notNull(),
    payloadPreview: text("payload_preview"),
    linqMessageId: text("linq_message_id"),
    dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [uniqueIndex("outbound_messages_key_idx").on(table.idempotencyKey)],
);
