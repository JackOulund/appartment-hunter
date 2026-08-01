import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import * as t from "../schema.js";
import type {
  ApplicationStatus,
  ContactCapability,
  HousingListing,
  ListingDecisionValue,
  SearchPreferences,
} from "../../domain/entities.js";
import { searchPreferencesSchema } from "../../domain/entities.js";
import type { ConversationState } from "../../domain/conversation-state.js";
import { newId } from "../../utils/ids.js";

const nowIso = (): string => new Date().toISOString();

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- users

export type UserRow = typeof t.users.$inferSelect;

export class UserRepository {
  constructor(private readonly db: Database) {}

  async findByHandle(linqHandle: string): Promise<UserRow | null> {
    const rows = await this.db.select().from(t.users).where(eq(t.users.linqHandle, linqHandle)).limit(1);
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const rows = await this.db.select().from(t.users).where(eq(t.users.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async ensure(linqHandle: string): Promise<UserRow> {
    const existing = await this.findByHandle(linqHandle);
    if (existing) return existing;
    const id = newId("usr");
    await this.db.insert(t.users).values({ id, linqHandle }).onConflictDoNothing();
    const created = await this.findByHandle(linqHandle);
    if (!created) throw new Error(`Failed to create user for handle ${linqHandle}`);
    return created;
  }

  async update(id: string, patch: Partial<typeof t.users.$inferInsert>): Promise<void> {
    await this.db.update(t.users).set({ ...patch, updatedAt: nowIso() }).where(eq(t.users.id, id));
  }

  /** Anonymises rather than hard-deleting so audit rows keep referential integrity. */
  async anonymise(id: string): Promise<void> {
    await this.db
      .update(t.users)
      .set({
        fullName: null,
        email: null,
        contactPhone: null,
        acceptedUniversityId: null,
        selectedCampusId: null,
        consentToStoreProfile: false,
        consentToShareContactDetails: false,
        linqHandle: `deleted:${id}`,
        deletedAt: nowIso(),
        updatedAt: nowIso(),
      })
      .where(eq(t.users.id, id));
  }
}

// -------------------------------------------------------- conversations

export type ConversationRow = typeof t.conversations.$inferSelect;

export class ConversationRepository {
  constructor(private readonly db: Database) {}

  async findByChatId(linqChatId: string): Promise<ConversationRow | null> {
    const rows = await this.db
      .select()
      .from(t.conversations)
      .where(eq(t.conversations.linqChatId, linqChatId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<ConversationRow | null> {
    const rows = await this.db.select().from(t.conversations).where(eq(t.conversations.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /** The chat id is not derivable from the handle, so background jobs look up by user. */
  async findByUserId(userId: string): Promise<ConversationRow | null> {
    const rows = await this.db
      .select()
      .from(t.conversations)
      .where(eq(t.conversations.userId, userId))
      .orderBy(desc(t.conversations.updatedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async ensure(userId: string, linqChatId: string): Promise<ConversationRow> {
    const existing = await this.findByChatId(linqChatId);
    if (existing) return existing;
    const id = newId("cnv");
    await this.db.insert(t.conversations).values({ id, userId, linqChatId }).onConflictDoNothing();
    const created = await this.findByChatId(linqChatId);
    if (!created) throw new Error(`Failed to create conversation for chat ${linqChatId}`);
    return created;
  }

  async setState(id: string, state: ConversationState): Promise<void> {
    await this.db
      .update(t.conversations)
      .set({ currentState: state, updatedAt: nowIso() })
      .where(eq(t.conversations.id, id));
  }

  async patch(id: string, patch: Partial<typeof t.conversations.$inferInsert>): Promise<void> {
    await this.db
      .update(t.conversations)
      .set({ ...patch, updatedAt: nowIso() })
      .where(eq(t.conversations.id, id));
  }

  getPayload<T extends Record<string, unknown>>(row: ConversationRow): T {
    return parseJson<T>(row.statePayload, {} as T);
  }

  async mergePayload(id: string, patch: Record<string, unknown>): Promise<void> {
    const row = await this.findById(id);
    if (!row) return;
    const merged = { ...this.getPayload(row), ...patch };
    await this.patch(id, { statePayload: JSON.stringify(merged) });
  }
}

// ------------------------------------------------------ search profiles

export type SearchProfileRow = typeof t.searchProfiles.$inferSelect;

export class SearchProfileRepository {
  constructor(private readonly db: Database) {}

  async findLatest(userId: string): Promise<SearchProfileRow | null> {
    const rows = await this.db
      .select()
      .from(t.searchProfiles)
      .where(eq(t.searchProfiles.userId, userId))
      .orderBy(desc(t.searchProfiles.version))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<SearchProfileRow | null> {
    const rows = await this.db.select().from(t.searchProfiles).where(eq(t.searchProfiles.id, id)).limit(1);
    return rows[0] ?? null;
  }

  toPreferences(row: SearchProfileRow): SearchPreferences {
    return searchPreferencesSchema.parse({
      city: row.city,
      preferredAreas: parseJson<string[]>(row.preferredAreas, []),
      excludedAreas: parseJson<string[]>(row.excludedAreas, []),
      maximumMonthlyRent: row.maximumMonthlyRent,
      currency: row.currency,
      preferredMoveInDate: row.preferredMoveInDate,
      minimumRentalMonths: row.minimumRentalMonths,
      minimumRooms: row.minimumRooms,
      minimumSizeSquareMeters: row.minimumSizeSquareMeters,
      furnishedPreference: row.furnishedPreference,
      maxCommuteMinutes: row.maxCommuteMinutes,
      commuteModes: parseJson<string[]>(row.commuteModes, ["bicycle"]),
      requiredAmenities: parseJson<string[]>(row.requiredAmenities, []),
      preferredAmenities: parseJson<string[]>(row.preferredAmenities, []),
      freeTextPreferences: row.freeTextPreferences,
    });
  }

  async upsert(userId: string, preferences: SearchPreferences): Promise<SearchProfileRow> {
    const existing = await this.findLatest(userId);
    const values = {
      city: preferences.city,
      preferredAreas: JSON.stringify(preferences.preferredAreas),
      excludedAreas: JSON.stringify(preferences.excludedAreas),
      maximumMonthlyRent: preferences.maximumMonthlyRent,
      currency: preferences.currency,
      preferredMoveInDate: preferences.preferredMoveInDate,
      minimumRentalMonths: preferences.minimumRentalMonths,
      minimumRooms: preferences.minimumRooms,
      minimumSizeSquareMeters: preferences.minimumSizeSquareMeters,
      furnishedPreference: preferences.furnishedPreference,
      maxCommuteMinutes: preferences.maxCommuteMinutes,
      commuteModes: JSON.stringify(preferences.commuteModes),
      requiredAmenities: JSON.stringify(preferences.requiredAmenities),
      preferredAmenities: JSON.stringify(preferences.preferredAmenities),
      freeTextPreferences: preferences.freeTextPreferences,
      updatedAt: nowIso(),
    };

    if (existing) {
      await this.db.update(t.searchProfiles).set(values).where(eq(t.searchProfiles.id, existing.id));
      const updated = await this.findById(existing.id);
      if (!updated) throw new Error("search profile vanished during update");
      return updated;
    }

    const id = newId("spf");
    await this.db.insert(t.searchProfiles).values({ id, userId, ...values });
    const created = await this.findById(id);
    if (!created) throw new Error("failed to create search profile");
    return created;
  }
}

// ----------------------------------------------------------- listings

export type ListingRow = typeof t.listings.$inferSelect;

export class ListingRepository {
  constructor(private readonly db: Database) {}

  toDomain(row: ListingRow): HousingListing {
    return {
      id: row.id,
      provider: row.provider,
      providerListingId: row.providerListingId,
      canonicalUrl: row.canonicalUrl,
      title: row.title,
      description: row.description,
      address: row.address,
      city: row.city,
      area: row.area,
      latitude: row.latitude,
      longitude: row.longitude,
      monthlyRent: row.monthlyRent,
      currency: row.currency,
      rooms: row.rooms,
      sizeSquareMeters: row.sizeSquareMeters,
      furnished: row.furnished,
      availableFrom: row.availableFrom,
      availableTo: row.availableTo,
      minimumRentalMonths: row.minimumRentalMonths,
      amenities: parseJson<string[]>(row.amenities, []),
      imageUrls: parseJson<string[]>(row.imageUrls, []),
      contactCapability: row.contactCapability as ContactCapability,
      providerMetadata: parseJson<Record<string, unknown>>(row.providerMetadata, {}),
      isActive: row.isActive,
    };
  }

  async upsertMany(listings: HousingListing[]): Promise<void> {
    if (listings.length === 0) return;
    for (const listing of listings) {
      await this.db
        .insert(t.listings)
        .values({
          id: listing.id,
          provider: listing.provider,
          providerListingId: listing.providerListingId,
          canonicalUrl: listing.canonicalUrl,
          title: listing.title,
          description: listing.description,
          address: listing.address,
          city: listing.city,
          area: listing.area,
          latitude: listing.latitude,
          longitude: listing.longitude,
          monthlyRent: listing.monthlyRent,
          currency: listing.currency,
          rooms: listing.rooms,
          sizeSquareMeters: listing.sizeSquareMeters,
          furnished: listing.furnished,
          availableFrom: listing.availableFrom,
          availableTo: listing.availableTo,
          minimumRentalMonths: listing.minimumRentalMonths,
          amenities: JSON.stringify(listing.amenities),
          imageUrls: JSON.stringify(listing.imageUrls),
          contactCapability: listing.contactCapability,
          providerMetadata: JSON.stringify(listing.providerMetadata),
          isActive: listing.isActive,
          lastSeenAt: nowIso(),
        })
        .onConflictDoUpdate({
          target: [t.listings.provider, t.listings.providerListingId],
          set: {
            title: listing.title,
            monthlyRent: listing.monthlyRent,
            isActive: listing.isActive,
            availableFrom: listing.availableFrom,
            availableTo: listing.availableTo,
            imageUrls: JSON.stringify(listing.imageUrls),
            lastSeenAt: nowIso(),
          },
        });
    }
  }

  async findById(id: string): Promise<HousingListing | null> {
    const rows = await this.db.select().from(t.listings).where(eq(t.listings.id, id)).limit(1);
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async findManyById(ids: string[]): Promise<HousingListing[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.select().from(t.listings).where(inArray(t.listings.id, ids));
    return rows.map((row) => this.toDomain(row));
  }
}

// --------------------------------------------------------- search runs

export class SearchRunRepository {
  constructor(private readonly db: Database) {}

  async create(userId: string, searchProfileId: string, provider: string): Promise<string> {
    const id = newId("run");
    await this.db.insert(t.searchRuns).values({ id, userId, searchProfileId, provider, status: "running" });
    return id;
  }

  async complete(id: string, resultCount: number): Promise<void> {
    await this.db
      .update(t.searchRuns)
      .set({ status: "completed", resultCount, completedAt: nowIso() })
      .where(eq(t.searchRuns.id, id));
  }

  async fail(id: string, errorMessage: string): Promise<void> {
    await this.db
      .update(t.searchRuns)
      .set({ status: "failed", errorMessage, completedAt: nowIso() })
      .where(eq(t.searchRuns.id, id));
  }

  async saveResults(
    searchRunId: string,
    results: { listingId: string; score: number; breakdown: unknown; position: number }[],
  ): Promise<void> {
    if (results.length === 0) return;
    await this.db.insert(t.searchResults).values(
      results.map((result) => ({
        id: newId("res"),
        searchRunId,
        listingId: result.listingId,
        score: result.score,
        scoreBreakdown: JSON.stringify(result.breakdown),
        rankingPosition: result.position,
      })),
    );
  }
}

// ------------------------------------------------------------- batches

export type ListingBatchRow = typeof t.listingBatches.$inferSelect;
export type ListingPresentationRow = typeof t.listingPresentations.$inferSelect;

export class BatchRepository {
  constructor(private readonly db: Database) {}

  async nextSequenceNumber(userId: string): Promise<number> {
    const rows = await this.db
      .select({ value: sql<number>`coalesce(max(${t.listingBatches.sequenceNumber}), 0)` })
      .from(t.listingBatches)
      .where(eq(t.listingBatches.userId, userId));
    return (rows[0]?.value ?? 0) + 1;
  }

  async create(userId: string, searchRunId: string): Promise<ListingBatchRow> {
    const id = newId("bat");
    const sequenceNumber = await this.nextSequenceNumber(userId);
    await this.db.insert(t.listingBatches).values({ id, userId, searchRunId, sequenceNumber });
    const row = await this.findById(id);
    if (!row) throw new Error("failed to create batch");
    return row;
  }

  async findById(id: string): Promise<ListingBatchRow | null> {
    const rows = await this.db.select().from(t.listingBatches).where(eq(t.listingBatches.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async setControlMessageId(batchId: string, messageId: string): Promise<void> {
    await this.db
      .update(t.listingBatches)
      .set({ controlMessageId: messageId })
      .where(eq(t.listingBatches.id, batchId));
  }

  async addPresentation(
    batchId: string,
    listingId: string,
    presentationOrder: number,
  ): Promise<ListingPresentationRow> {
    const id = newId("prs");
    await this.db.insert(t.listingPresentations).values({ id, batchId, listingId, presentationOrder });
    const rows = await this.db
      .select()
      .from(t.listingPresentations)
      .where(eq(t.listingPresentations.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error("failed to create presentation");
    return row;
  }

  async setPresentationMessageIds(
    presentationId: string,
    ids: { summaryMessageId?: string; mediaMessageId?: string; linkMessageId?: string },
  ): Promise<void> {
    await this.db
      .update(t.listingPresentations)
      .set(ids)
      .where(eq(t.listingPresentations.id, presentationId));
  }

  async listPresentations(batchId: string): Promise<ListingPresentationRow[]> {
    return this.db
      .select()
      .from(t.listingPresentations)
      .where(eq(t.listingPresentations.batchId, batchId))
      .orderBy(asc(t.listingPresentations.presentationOrder));
  }

  /** Reaction routing: which listing does this Linq message belong to? */
  async findPresentationByMessageId(messageId: string): Promise<ListingPresentationRow | null> {
    const rows = await this.db
      .select()
      .from(t.listingPresentations)
      .where(
        sql`${t.listingPresentations.summaryMessageId} = ${messageId}
          or ${t.listingPresentations.mediaMessageId} = ${messageId}
          or ${t.listingPresentations.linkMessageId} = ${messageId}`,
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findBatchByControlMessageId(messageId: string): Promise<ListingBatchRow | null> {
    const rows = await this.db
      .select()
      .from(t.listingBatches)
      .where(eq(t.listingBatches.controlMessageId, messageId))
      .limit(1);
    return rows[0] ?? null;
  }
}

// ----------------------------------------------------------- decisions

export type ListingDecisionRow = typeof t.listingDecisions.$inferSelect;

export class DecisionRepository {
  constructor(private readonly db: Database) {}

  async record(input: {
    userId: string;
    listingId: string;
    batchId?: string | null;
    decision: ListingDecisionValue;
    source: string;
    sourceMessageId?: string | null;
  }): Promise<void> {
    await this.db
      .insert(t.listingDecisions)
      .values({
        id: newId("dec"),
        userId: input.userId,
        listingId: input.listingId,
        batchId: input.batchId ?? null,
        decision: input.decision,
        source: input.source,
        sourceMessageId: input.sourceMessageId ?? null,
      })
      .onConflictDoUpdate({
        target: [t.listingDecisions.userId, t.listingDecisions.listingId],
        set: {
          decision: input.decision,
          source: input.source,
          sourceMessageId: input.sourceMessageId ?? null,
          batchId: input.batchId ?? null,
          updatedAt: nowIso(),
        },
      });
  }

  async find(userId: string, listingId: string): Promise<ListingDecisionRow | null> {
    const rows = await this.db
      .select()
      .from(t.listingDecisions)
      .where(and(eq(t.listingDecisions.userId, userId), eq(t.listingDecisions.listingId, listingId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByUser(userId: string): Promise<ListingDecisionRow[]> {
    return this.db.select().from(t.listingDecisions).where(eq(t.listingDecisions.userId, userId));
  }

  /**
   * Anything already presented is excluded from the next batch — including rows
   * still marked `unseen`, which mean "shown but not yet reacted to". Without
   * that, a second batch would repeat apartments the user is already looking at.
   */
  async excludedListingIds(userId: string): Promise<Set<string>> {
    const rows = await this.listByUser(userId);
    return new Set(rows.map((row) => row.listingId));
  }

  async listByDecision(userId: string, decision: ListingDecisionValue): Promise<ListingDecisionRow[]> {
    return this.db
      .select()
      .from(t.listingDecisions)
      .where(and(eq(t.listingDecisions.userId, userId), eq(t.listingDecisions.decision, decision)));
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.db.delete(t.listingDecisions).where(eq(t.listingDecisions.userId, userId));
  }
}

// ---------------------------------------------------------- view events

export type ListingViewEventRow = typeof t.listingViewEvents.$inferSelect;

export class ListingViewEventRepository {
  constructor(private readonly db: Database) {}

  async record(input: {
    userId: string;
    listingId: string;
    batchId?: string | null;
    event: string;
  }): Promise<void> {
    await this.db.insert(t.listingViewEvents).values({
      id: newId("vev"),
      userId: input.userId,
      listingId: input.listingId,
      batchId: input.batchId ?? null,
      event: input.event,
    });
  }

  async listForUser(userId: string): Promise<ListingViewEventRow[]> {
    return this.db
      .select()
      .from(t.listingViewEvents)
      .where(eq(t.listingViewEvents.userId, userId))
      // rowid, not createdAt: several events can land inside the same millisecond.
      .orderBy(sql`rowid`);
  }

  async listForListing(userId: string, listingId: string): Promise<ListingViewEventRow[]> {
    return this.db
      .select()
      .from(t.listingViewEvents)
      .where(
        and(eq(t.listingViewEvents.userId, userId), eq(t.listingViewEvents.listingId, listingId)),
      )
      .orderBy(sql`rowid`);
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.db.delete(t.listingViewEvents).where(eq(t.listingViewEvents.userId, userId));
  }
}

// -------------------------------------------------------- applications

export type ApplicationRow = typeof t.applications.$inferSelect;

export class ApplicationRepository {
  constructor(private readonly db: Database) {}

  async create(input: {
    userId: string;
    listingId: string;
    draftMessage: string;
  }): Promise<ApplicationRow> {
    const id = newId("app");
    await this.db.insert(t.applications).values({ ...input, id, status: "draft" });
    const row = await this.findById(id);
    if (!row) throw new Error("failed to create application");
    return row;
  }

  async findById(id: string): Promise<ApplicationRow | null> {
    const rows = await this.db.select().from(t.applications).where(eq(t.applications.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findActiveForListing(userId: string, listingId: string): Promise<ApplicationRow | null> {
    const rows = await this.db
      .select()
      .from(t.applications)
      .where(and(eq(t.applications.userId, userId), eq(t.applications.listingId, listingId)))
      .orderBy(desc(t.applications.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async patch(id: string, patch: Partial<typeof t.applications.$inferInsert>): Promise<void> {
    await this.db
      .update(t.applications)
      .set({ ...patch, updatedAt: nowIso() })
      .where(eq(t.applications.id, id));
  }

  async setStatus(id: string, status: ApplicationStatus): Promise<void> {
    await this.patch(id, { status });
  }

  async listByUser(userId: string): Promise<ApplicationRow[]> {
    return this.db.select().from(t.applications).where(eq(t.applications.userId, userId));
  }
}

// -------------------------------------------------------------- leases

export type LeaseRow = typeof t.leases.$inferSelect;

export class LeaseRepository {
  constructor(private readonly db: Database) {}

  /** The repository owns id generation; callers never supply one. */
  async create(input: Omit<typeof t.leases.$inferInsert, "id">): Promise<LeaseRow> {
    const id = newId("lse");
    await this.db.insert(t.leases).values({ ...input, id });
    const rows = await this.db.select().from(t.leases).where(eq(t.leases.id, id)).limit(1);
    const row = rows[0];
    if (!row) throw new Error("failed to create lease");
    return row;
  }

  async findById(id: string): Promise<LeaseRow | null> {
    const rows = await this.db.select().from(t.leases).where(eq(t.leases.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findActiveForUser(userId: string): Promise<LeaseRow | null> {
    const rows = await this.db
      .select()
      .from(t.leases)
      .where(and(eq(t.leases.userId, userId), eq(t.leases.status, "active")))
      .orderBy(desc(t.leases.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Leases whose renewal window has opened and that were not reminded yet. */
  async findDueForRenewal(asOf: Date): Promise<LeaseRow[]> {
    return this.db
      .select()
      .from(t.leases)
      .where(
        and(
          eq(t.leases.status, "active"),
          isNotNull(t.leases.renewalSearchAt),
          lte(t.leases.renewalSearchAt, asOf.toISOString()),
          sql`${t.leases.renewalReminderSentAt} is null`,
        ),
      );
  }

  async markReminded(id: string): Promise<void> {
    await this.db
      .update(t.leases)
      .set({ renewalReminderSentAt: nowIso(), updatedAt: nowIso() })
      .where(eq(t.leases.id, id));
  }
}

// ------------------------------------------------------ webhook events

export class WebhookEventRepository {
  constructor(private readonly db: Database) {}

  /** Returns false when the event was already recorded (duplicate delivery). */
  async claim(input: {
    providerEventId: string;
    eventType: string;
    traceId?: string | null;
  }): Promise<boolean> {
    const result = await this.db
      .insert(t.webhookEvents)
      .values({
        id: newId("whe"),
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        traceId: input.traceId ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: t.webhookEvents.id });
    return result.length > 0;
  }

  async markProcessed(providerEventId: string): Promise<void> {
    await this.db
      .update(t.webhookEvents)
      .set({ status: "processed", processedAt: nowIso() })
      .where(eq(t.webhookEvents.providerEventId, providerEventId));
  }

  async markFailed(providerEventId: string, failureReason: string): Promise<void> {
    await this.db
      .update(t.webhookEvents)
      .set({ status: "failed", failureReason, processedAt: nowIso() })
      .where(eq(t.webhookEvents.providerEventId, providerEventId));
  }
}

// --------------------------------------------------- outbound messages

export class OutboundMessageRepository {
  constructor(private readonly db: Database) {}

  async findByKey(idempotencyKey: string): Promise<typeof t.outboundMessages.$inferSelect | null> {
    const rows = await this.db
      .select()
      .from(t.outboundMessages)
      .where(eq(t.outboundMessages.idempotencyKey, idempotencyKey))
      .limit(1);
    return rows[0] ?? null;
  }

  async record(input: {
    idempotencyKey: string;
    conversationId?: string | null;
    linqChatId: string;
    kind: string;
    payloadPreview: string;
    linqMessageId: string;
    dryRun: boolean;
  }): Promise<void> {
    await this.db
      .insert(t.outboundMessages)
      .values({ id: newId("out"), ...input, conversationId: input.conversationId ?? null })
      .onConflictDoNothing();
  }

  async listForChat(linqChatId: string): Promise<(typeof t.outboundMessages.$inferSelect)[]> {
    return this.db
      .select()
      .from(t.outboundMessages)
      .where(eq(t.outboundMessages.linqChatId, linqChatId))
      .orderBy(asc(t.outboundMessages.createdAt));
  }
}

// ------------------------------------------------------------ bundle

export interface Repositories {
  users: UserRepository;
  conversations: ConversationRepository;
  searchProfiles: SearchProfileRepository;
  listings: ListingRepository;
  searchRuns: SearchRunRepository;
  batches: BatchRepository;
  decisions: DecisionRepository;
  viewEvents: ListingViewEventRepository;
  applications: ApplicationRepository;
  leases: LeaseRepository;
  webhookEvents: WebhookEventRepository;
  outbound: OutboundMessageRepository;
}

export function createRepositories(db: Database): Repositories {
  return {
    users: new UserRepository(db),
    conversations: new ConversationRepository(db),
    searchProfiles: new SearchProfileRepository(db),
    listings: new ListingRepository(db),
    searchRuns: new SearchRunRepository(db),
    batches: new BatchRepository(db),
    decisions: new DecisionRepository(db),
    viewEvents: new ListingViewEventRepository(db),
    applications: new ApplicationRepository(db),
    leases: new LeaseRepository(db),
    webhookEvents: new WebhookEventRepository(db),
    outbound: new OutboundMessageRepository(db),
  };
}
