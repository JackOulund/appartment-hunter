import type { ConversationRow, Repositories, UserRow } from "../database/repositories/index.js";
import type { LinqAdapter } from "../integrations/linq/linq-client.js";
import type { ExtractedPreferences, LlmProvider, TurnContext } from "../integrations/llm/llm-provider.js";
import type { TurnDecision } from "../integrations/llm/turn-schema.js";
import type { UniversityProvider } from "../integrations/university/university-provider.js";
import type { SearchService } from "./search-service.js";
import type { PresentationService } from "./presentation-service.js";
import type { ApplicationService } from "./application-service.js";
import type { ReactionService } from "./reaction-service.js";
import { hasAllContactDetails, missingContactDetails } from "./application-service.js";
import {
  isConversationState,
  transition,
  type ConversationState,
} from "../domain/conversation-state.js";
import { parseCommand, type Command } from "../domain/command-parser.js";
import {
  missingRequiredFields,
  searchPreferencesSchema,
  type Language,
  type SearchPreferences,
} from "../domain/entities.js";
import { toCommand, replyFor } from "../domain/intent.js";
import { guardReply } from "../domain/reply-guard.js";
import {
  buildCampusQuestion,
  buildCongratulations,
  buildPreferenceSummary,
  QUESTION_PROMPTS,
} from "../integrations/linq/message-builder.js";
import { idempotencyKeys } from "../utils/ids.js";
import { logger } from "../utils/logger.js";
import { previewText } from "../security/redaction.js";
import { env } from "../config/env.js";

export interface InboundMessageInput {
  chatId: string;
  senderHandle: string;
  messageId: string;
  text: string;
  isGroup?: boolean;
}

export interface InboundReactionInput {
  chatId: string;
  senderHandle: string;
  action: "added" | "removed";
  reactionType: string;
  targetMessageId: string | null;
}

interface StatePayload extends Record<string, unknown> {
  preferences?: Partial<SearchPreferences>;
  pendingUniversityCandidates?: { id: string; name: string }[];
  pendingCampusChoices?: { id: string; name: string }[];
  pendingContactListingIds?: string[];
  awaitingDeleteConfirmation?: boolean;
  awaitingContactField?: "fullName" | "email" | "phone";
  language?: Language;
  /** True once shareContactCard has been attempted for this conversation — success or not. */
  contactCardShared?: boolean;
  /** Rolling window, oldest first, max 6 — mirrors TurnContext.recentTurns. */
  recentTurns?: { role: "user" | "agent"; text: string }[];
}

/** Mirrors toCommand's default — a chat reply below this is a guess, not a decision. */
const MIN_CHAT_CONFIDENCE = 0.6;

/** True when a decideTurn extraction found nothing worth merging — every field is null or empty. */
function isEmptyExtraction(preferences: ExtractedPreferences): boolean {
  return Object.values(preferences).every(
    (value) => value === null || (Array.isArray(value) && value.length === 0),
  );
}

export interface ConversationDeps {
  repos: Repositories;
  linq: LinqAdapter;
  llm: LlmProvider;
  universities: UniversityProvider;
  search: SearchService;
  presentation: PresentationService;
  applications: ApplicationService;
  reactions: ReactionService;
}

export interface ConversationOptions {
  /** Off restores pre-LLM deterministic-only routing without a deploy. */
  llmIntent?: boolean;
}

export class ConversationService {
  private readonly repos: Repositories;
  private readonly linq: LinqAdapter;
  private readonly llm: LlmProvider;
  private readonly universities: UniversityProvider;
  private readonly search: SearchService;
  private readonly presentation: PresentationService;
  private readonly applications: ApplicationService;
  private readonly reactions: ReactionService;
  private readonly llmIntent: boolean;

  constructor(deps: ConversationDeps, options: ConversationOptions = {}) {
    this.repos = deps.repos;
    this.linq = deps.linq;
    this.llm = deps.llm;
    this.universities = deps.universities;
    this.search = deps.search;
    this.presentation = deps.presentation;
    this.applications = deps.applications;
    this.reactions = deps.reactions;
    this.llmIntent = options.llmIntent ?? env.LLM_INTENT;
  }

  // ------------------------------------------------------------ plumbing

  private async load(chatId: string, senderHandle: string): Promise<{ user: UserRow; conversation: ConversationRow }> {
    const user = await this.repos.users.ensure(senderHandle);
    const conversation = await this.repos.conversations.ensure(user.id, chatId);
    return { user, conversation };
  }

  private payload(conversation: ConversationRow): StatePayload {
    return this.repos.conversations.getPayload<StatePayload>(conversation);
  }

  private state(conversation: ConversationRow): ConversationState {
    return isConversationState(conversation.currentState) ? conversation.currentState : "NEW";
  }

  /**
   * Every state change goes through here so invalid transitions are logged.
   * The current state is re-read from storage: a handler often performs several
   * transitions in a row, and the in-memory row goes stale after the first.
   */
  private async moveTo(conversation: ConversationRow, next: ConversationState): Promise<void> {
    const fresh = await this.repos.conversations.findById(conversation.id);
    const current = fresh ? this.state(fresh) : this.state(conversation);

    const result = transition(current, next);
    if (result.rejected) {
      logger.warn(
        { conversationId: conversation.id, from: current, to: next },
        "rejected invalid state transition",
      );
      return;
    }
    if (result.changed) {
      await this.repos.conversations.setState(conversation.id, result.state);
      // Keep the caller's copy usable for any subsequent read.
      conversation.currentState = result.state;
    }
  }

  private async say(
    conversation: ConversationRow,
    text: string,
    tag: string,
    opts?: { effect?: { name: string; type: "screen" | "bubble" } },
  ): Promise<void> {
    await this.linq.sendText({
      chatId: conversation.linqChatId,
      conversationId: conversation.id,
      text,
      idempotencyKey: idempotencyKeys.ad_hoc(conversation.id, `${tag}:${Date.now()}`),
      ...(opts?.effect ? { effect: opts.effect } : {}),
    });
    await this.appendRecentTurn(conversation, "agent", text);
  }

  /**
   * Feeds TurnContext.recentTurns. Re-reads the row rather than trusting the
   * caller's copy, because several say() calls can happen inside one turn.
   */
  private async appendRecentTurn(
    conversation: ConversationRow,
    role: "user" | "agent",
    text: string,
  ): Promise<void> {
    const fresh = await this.repos.conversations.findById(conversation.id);
    const current = fresh ? (this.payload(fresh).recentTurns ?? []) : [];
    const next = [...current, { role, text: text.slice(0, 300) }].slice(-6);
    await this.repos.conversations.mergePayload(conversation.id, { recentTurns: next });
  }

  private async language(conversation: ConversationRow, user: UserRow, text: string): Promise<Language> {
    const stored = this.payload(conversation).language ?? (user.preferredLanguage as Language | undefined);
    if (stored) return stored;
    const detected = await this.llm.detectLanguage(text);
    await this.repos.conversations.mergePayload(conversation.id, { language: detected });
    await this.repos.users.update(user.id, { preferredLanguage: detected });
    return detected;
  }

  // ------------------------------------------------------- inbound text

  async handleInboundMessage(input: InboundMessageInput): Promise<void> {
    if (!input.text.trim()) return;

    const { user, conversation } = await this.load(input.chatId, input.senderHandle);
    if (user.deletedAt) {
      logger.info({ conversationId: conversation.id }, "ignoring message from deleted user");
      return;
    }

    if (!this.payload(conversation).contactCardShared) {
      try {
        await this.linq.shareContactCard(input.chatId);
      } catch (error) {
        logger.warn({ conversationId: conversation.id, error: String(error) }, "shareContactCard failed");
      }
      // One attempt per conversation, success or not — a misconfigured account
      // (no contact card set up yet) must not retry on every inbound message.
      await this.repos.conversations.mergePayload(conversation.id, { contactCardShared: true });
    }

    await this.repos.conversations.patch(conversation.id, { lastInboundMessageId: input.messageId });
    await this.appendRecentTurn(conversation, "user", input.text);
    await this.linq.startTyping(input.chatId);

    const language = await this.language(conversation, user, input.text);
    const command = parseCommand(input.text);

    logger.info(
      { conversationId: conversation.id, state: conversation.currentState, command: command.kind, preview: previewText(input.text) },
      "inbound message",
    );

    try {
      await this.route({ user, conversation, command, text: input.text, language });
    } finally {
      await this.linq.stopTyping(input.chatId);
    }
  }

  private async route(ctx: {
    user: UserRow;
    conversation: ConversationRow;
    command: Command;
    text: string;
    language: Language;
  }): Promise<void> {
    const { user, conversation, command, text, language } = ctx;
    const payload = this.payload(conversation);

    // Privacy and lifecycle commands take precedence over conversation state.
    if (payload.awaitingDeleteConfirmation) {
      if (/^(yes|ja|confirm|bekräfta|bekrafta|delete)$/i.test(text.trim())) {
        await this.deleteUserData(user, conversation, language);
        return;
      }
      await this.repos.conversations.mergePayload(conversation.id, { awaitingDeleteConfirmation: false });
      await this.say(conversation, language === "sv" ? "Okej, jag raderar ingenting." : "Understood, nothing was deleted.", "delete-cancel");
      return;
    }

    switch (command.kind) {
      case "delete_data":
        await this.repos.conversations.mergePayload(conversation.id, { awaitingDeleteConfirmation: true });
        await this.say(
          conversation,
          language === "sv"
            ? "Vill du att jag raderar alla dina uppgifter? Svara JA för att bekräfta. Det går inte att ångra."
            : "Do you want me to delete all of your data? Reply YES to confirm. This cannot be undone.",
          "delete-confirm",
        );
        return;

      case "start_over":
        await this.resetProfile(user, conversation, language);
        return;

      case "pause":
        await this.moveTo(conversation, "PAUSED");
        await this.say(conversation, language === "sv" ? "Pausat. Skriv FORTSÄTT när du vill fortsätta." : "Paused. Send RESUME whenever you want to continue.", "pause");
        return;

      case "resume":
        await this.moveTo(conversation, "REVIEWING_RESULTS");
        await this.say(conversation, language === "sv" ? "Vi fortsätter. Skriv FLER för tre nya lägenheter." : "We're back. Send MORE for three new apartments.", "resume");
        return;

      case "help":
        await this.say(conversation, this.helpText(language), "help");
        return;

      case "got_apartment":
        await this.moveTo(conversation, "TRACKING_RENTAL");
        await this.say(
          conversation,
          language === "sv"
            ? "Vad kul! När börjar och slutar hyresperioden? Svara till exempel: 2026-09-01 till 2027-06-30."
            : "That's great! When does the rental start and end? For example: 2026-09-01 to 2027-06-30.",
          "lease-dates",
        );
        return;
      default:
        break;
    }

    const state = this.state(conversation);

    // Lease dates while tracking a rental.
    if (state === "TRACKING_RENTAL") {
      await this.captureLeaseDates(user, conversation, text, language);
      return;
    }

    // Collecting contact details for an application.
    if (state === "AWAITING_CONTACT_DETAILS") {
      await this.captureContactDetail(user, conversation, text, language);
      return;
    }

    const handled = await this.dispatchCommand({ user, conversation, text, language }, command);
    if (handled) return;

    // The deterministic parser found nothing actionable — let the model have
    // one shot at reading intent before falling back to onboarding/extraction.
    if (this.llmIntent) {
      const llmHandled = await this.decideWithLlm(ctx);
      if (llmHandled) return;
    }

    await this.continueOnboarding(user, conversation, text, language);
  }

  /**
   * Runs the action commands the deterministic parser or the LLM proposed.
   * Returns false for anything it doesn't recognise so the caller can fall
   * through to the next stage — never throws on an unknown kind.
   */
  private async dispatchCommand(
    ctx: { user: UserRow; conversation: ConversationRow; text: string; language: Language },
    command: Command,
  ): Promise<boolean> {
    const { user, conversation, language } = ctx;

    switch (command.kind) {
      case "search":
        await this.startSearch(user, conversation, language);
        return true;
      case "more":
        await this.startSearch(user, conversation, language);
        return true;
      case "stop":
        await this.moveTo(conversation, "AWAITING_CONTACT_SELECTION");
        await this.offerShortlist(user, conversation, language);
        return true;
      case "like":
      case "reject":
        await this.applyPositionalDecision(user, conversation, command, language);
        return true;
      case "contact":
        await this.beginContact(user, conversation, command.positions, language);
        return true;
      case "contact_all_liked":
        await this.beginContactAllLiked(user, conversation, language);
        return true;
      case "change_preference":
        await this.applyPreferenceChange(user, conversation, command, language);
        return true;
      default:
        return false;
    }
  }

  /**
   * The one and only decideTurn call for an inbound message. Never re-enters
   * itself: dispatchCommand contains no LLM calls, so a command it proposes
   * is applied deterministically, not re-interpreted.
   */
  private async decideWithLlm(ctx: {
    user: UserRow;
    conversation: ConversationRow;
    command: Command;
    text: string;
    language: Language;
  }): Promise<boolean> {
    const { user, conversation, text, language } = ctx;

    const fresh = (await this.repos.conversations.findById(conversation.id)) ?? conversation;
    const payload = this.payload(fresh);
    const state = this.state(fresh);

    // The LLM path is fully off for opted-out conversations — command proposals
    // and chat both. Deterministic handling (the opted-out notice / an explicit
    // restart) is the only thing allowed to speak here.
    if (state === "OPTED_OUT") return false;

    const knownPreferences: Record<string, unknown> = payload.preferences ?? {};
    const roster = await this.buildRoster(fresh);

    const turnContext: TurnContext = {
      text,
      state,
      language,
      missingFields: missingRequiredFields(payload.preferences ?? {}),
      knownPreferences,
      roster,
      recentTurns: payload.recentTurns ?? [],
    };

    let decision: TurnDecision;
    try {
      decision = await this.llm.decideTurn(turnContext);
    } catch (error) {
      logger.warn({ conversationId: conversation.id, error: String(error) }, "llm decideTurn failed");
      return false;
    }

    const command = toCommand(decision);
    if (command !== null) {
      logger.info(
        { conversationId: conversation.id, proposed: command.kind, confidence: decision.confidence },
        "llm proposed command",
      );
      return this.dispatchCommand({ user, conversation, text, language }, command);
    }

    // Same floor toCommand applies to a proposed command: below it, the model's
    // chat reply is a guess, not something confident enough to send on its own —
    // deterministic onboarding takes the message instead.
    if (decision.command.kind !== "chat" || decision.confidence < MIN_CHAT_CONFIDENCE) return false;

    // Only the deterministic university flow may acknowledge a university. A
    // confident chat reply here (e.g. "Congratulations on Lund!") would let the
    // model swallow the message before resolveUniversity ever runs, so
    // acceptedUniversityId never gets persisted and the same question repeats.
    if (!user.acceptedUniversityId || state === "NEW" || state === "COLLECTING_UNIVERSITY") return false;

    const reply = replyFor(decision, null);
    if (reply === null) return false;

    const facts = [
      ...Object.values(knownPreferences)
        .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
        .map((value) => String(value)),
      ...roster.map((r) => `${r.position}. ${r.title} — ${r.monthlyRent} ${r.currency}`),
    ];
    const guard = guardReply(reply, facts);

    if (!guard.ok || guard.text === null) {
      logger.warn({ conversationId: conversation.id, reason: guard.reason }, "llm reply rejected by guard");
      return false;
    }

    // In onboarding states the guarded reply rides along with continueOnboarding
    // instead of being sent on its own, so the user is never double-messaged.
    if (state === "COLLECTING_PREFERENCES" || state === "CONFIRMING_PREFERENCES") {
      // A combined decideTurn call that extracted nothing must not be trusted as
      // "no preferences in this message" — let continueOnboarding run its own
      // dedicated extraction instead of silently storing an empty merge, which
      // is what produces the "same question re-asked" loop.
      const preextracted = isEmptyExtraction(decision.preferences) ? undefined : decision.preferences;
      await this.continueOnboarding(user, conversation, text, language, preextracted, guard.text);
      return true;
    }

    await this.say(conversation, guard.text, "llm-chat");
    return true;
  }

  private async buildRoster(conversation: ConversationRow): Promise<TurnContext["roster"]> {
    if (!conversation.activeBatchId) return [];
    const presentations = await this.repos.batches.listPresentations(conversation.activeBatchId);
    if (presentations.length === 0) return [];

    const listings = await this.repos.listings.findManyById(presentations.map((p) => p.listingId));
    const byId = new Map(listings.map((listing) => [listing.id, listing]));

    const roster: TurnContext["roster"] = [];
    for (const presentation of presentations) {
      const listing = byId.get(presentation.listingId);
      if (!listing) continue;
      roster.push({
        position: presentation.presentationOrder,
        title: listing.title,
        monthlyRent: listing.monthlyRent,
        currency: listing.currency,
      });
    }
    return roster;
  }

  // ----------------------------------------------------------- onboarding

  private async continueOnboarding(
    user: UserRow,
    conversation: ConversationRow,
    text: string,
    language: Language,
    preextracted?: ExtractedPreferences,
    phrasedReply?: string | null,
  ): Promise<void> {
    const payload = this.payload(conversation);

    // Pending campus choice, answered by number or name.
    if (payload.pendingCampusChoices?.length) {
      const chosen = this.matchChoice(text, payload.pendingCampusChoices);
      if (chosen) {
        await this.repos.users.update(user.id, { selectedCampusId: chosen.id });
        await this.repos.conversations.mergePayload(conversation.id, { pendingCampusChoices: [] });
        await this.askNextPreference(user, conversation, language, phrasedReply);
        return;
      }
      const universityName = user.acceptedUniversityId
        ? (this.universities.getById(user.acceptedUniversityId)?.officialName ?? "")
        : "";
      await this.say(
        conversation,
        buildCampusQuestion(universityName, payload.pendingCampusChoices, language),
        "campus-retry",
      );
      return;
    }

    if (!user.acceptedUniversityId) {
      await this.resolveUniversity(user, conversation, text, language);
      return;
    }

    // Extract whatever preferences the message contains, then ask for the next gap.
    // A caller that already ran decideTurn passes its extraction in directly so
    // this never spends a second LLM call on the same message.
    const extracted = preextracted ?? (await this.llm.extractPreferences(text, { language }));
    const current = payload.preferences ?? {};
    const merged: Partial<SearchPreferences> = { ...current };

    for (const [key, value] of Object.entries(extracted)) {
      if (value === null || (Array.isArray(value) && value.length === 0)) continue;
      (merged as Record<string, unknown>)[key] = value;
    }

    const university = this.universities.getById(user.acceptedUniversityId);
    if (university && !merged.city) merged.city = university.city;

    await this.repos.conversations.mergePayload(conversation.id, { preferences: merged });
    await this.askNextPreference(user, conversation, language, phrasedReply);
  }

  private async resolveUniversity(
    user: UserRow,
    conversation: ConversationRow,
    text: string,
    language: Language,
  ): Promise<void> {
    await this.moveTo(conversation, "COLLECTING_UNIVERSITY");
    const matches = this.universities.match(text);

    if (matches.length === 0) {
      const guess = await this.llm.guessUniversity(text);
      const fromGuess = guess.universityName ? this.universities.match(guess.universityName) : [];
      if (fromGuess.length === 0) {
        await this.say(
          conversation,
          language === "sv"
            ? "Grattis till antagningen! Vilket universitet har du kommit in på?"
            : "Congratulations on your acceptance! Which university were you accepted to?",
          "ask-university",
        );
        return;
      }
      matches.push(...fromGuess);
    }

    const best = matches[0];
    if (!best) return;

    // Ambiguous between two universities — ask rather than guess.
    if (matches.length > 1 && matches[1] && matches[1].confidence >= best.confidence) {
      const options = matches.slice(0, 3).map((m, i) => `${i + 1}. ${m.university.officialName}`).join("\n");
      await this.say(
        conversation,
        language === "sv" ? `Vilket menar du?\n\n${options}` : `Which one do you mean?\n\n${options}`,
        "university-ambiguous",
      );
      return;
    }

    await this.repos.users.update(user.id, {
      acceptedUniversityId: best.university.id,
      consentToStoreProfile: true,
    });
    const refreshed = await this.repos.users.findById(user.id);
    if (!refreshed) return;

    await this.repos.conversations.mergePayload(conversation.id, {
      preferences: { ...(this.payload(conversation).preferences ?? {}), city: best.university.city },
    });
    await this.moveTo(conversation, "COLLECTING_PREFERENCES");

    await this.say(conversation, buildCongratulations(best.university.officialName, language), "congrats", {
      effect: { name: "confetti", type: "screen" },
    });

    // Multi-campus universities materially change the search — ask up front.
    if (best.university.campuses.length > 1) {
      const choices = best.university.campuses.map((c) => ({ id: c.id, name: c.name }));
      await this.repos.conversations.mergePayload(conversation.id, { pendingCampusChoices: choices });
      await this.say(
        conversation,
        buildCampusQuestion(best.university.officialName, choices, language),
        "campus",
      );
    }
  }

  private async askNextPreference(
    user: UserRow,
    conversation: ConversationRow,
    language: Language,
    phrasedReply?: string | null,
  ): Promise<void> {
    const fresh = await this.repos.conversations.findById(conversation.id);
    if (!fresh) return;
    const preferences = this.payload(fresh).preferences ?? {};
    const missing = missingRequiredFields(preferences);

    if (missing.length > 0) {
      const field = missing[0] as string;
      await this.moveTo(fresh, "COLLECTING_PREFERENCES");
      if (typeof phrasedReply === "string") {
        // Already guarded upstream — never sent alongside the template.
        await this.say(fresh, phrasedReply, `ask-${field}`);
      } else {
        const prompt = QUESTION_PROMPTS[field]?.[language];
        if (prompt) await this.say(fresh, prompt, `ask-${field}`);
      }
      return;
    }

    await this.confirmPreferences(user, fresh, language);
  }

  private async confirmPreferences(
    user: UserRow,
    conversation: ConversationRow,
    language: Language,
  ): Promise<void> {
    const preferences = searchPreferencesSchema.parse(this.payload(conversation).preferences ?? {});
    await this.repos.searchProfiles.upsert(user.id, preferences);
    await this.moveTo(conversation, "CONFIRMING_PREFERENCES");

    const university = user.acceptedUniversityId
      ? this.universities.getById(user.acceptedUniversityId)
      : null;
    await this.say(
      conversation,
      buildPreferenceSummary(preferences, university?.officialName ?? "", language),
      "confirm-preferences",
    );
  }

  private async applyPreferenceChange(
    user: UserRow,
    conversation: ConversationRow,
    command: Extract<Command, { kind: "change_preference" }>,
    language: Language,
  ): Promise<void> {
    const payload = this.payload(conversation);
    const preferences = { ...(payload.preferences ?? {}) } as Record<string, unknown>;
    preferences[command.field] = command.value;
    await this.repos.conversations.mergePayload(conversation.id, { preferences });

    const missing = missingRequiredFields(preferences as Partial<SearchPreferences>);
    if (missing.length > 0) {
      await this.askNextPreference(user, conversation, language);
      return;
    }
    const refreshed = await this.repos.conversations.findById(conversation.id);
    if (refreshed) await this.confirmPreferences(user, refreshed, language);
  }

  // --------------------------------------------------------------- search

  private async startSearch(
    user: UserRow,
    conversation: ConversationRow,
    language: Language,
  ): Promise<void> {
    const stored = await this.repos.searchProfiles.findLatest(user.id);
    const payloadPrefs = this.payload(conversation).preferences;
    const preferences = stored
      ? this.repos.searchProfiles.toPreferences(stored)
      : searchPreferencesSchema.parse(payloadPrefs ?? {});

    if (missingRequiredFields(preferences).length > 0) {
      await this.askNextPreference(user, conversation, language);
      return;
    }

    await this.moveTo(conversation, "READY_TO_SEARCH");
    await this.moveTo(conversation, "SEARCHING");

    const result = await this.search.run({
      userId: user.id,
      preferences,
      universityId: user.acceptedUniversityId,
      campusId: user.selectedCampusId,
    });

    if (result.ranked.length === 0) {
      await this.moveTo(conversation, "REVIEWING_RESULTS");
      await this.say(
        conversation,
        language === "sv"
          ? "Jag hittade inga fler lägenheter som matchar. Vill du ändra budget eller restid?"
          : "I could not find any more apartments that match. Would you like to change your budget or commute limit?",
        "no-results",
      );
      return;
    }

    await this.moveTo(conversation, "PRESENTING_RESULTS");
    const isFirstBatch = (await this.repos.batches.nextSequenceNumber(user.id)) === 1;
    await this.presentation.presentBatch({
      userId: user.id,
      conversationId: conversation.id,
      chatId: conversation.linqChatId,
      searchRunId: result.searchRunId,
      ranked: result.ranked,
      language,
      isFirstBatch,
    });
    await this.moveTo(conversation, "AWAITING_MORE_DECISION");
  }

  // ------------------------------------------------------------ reactions

  async handleInboundReaction(input: InboundReactionInput): Promise<void> {
    const { user, conversation } = await this.load(input.chatId, input.senderHandle);
    const language = this.payload(conversation).language ?? (user.preferredLanguage as Language);

    const outcome = await this.reactions.handle({
      userId: user.id,
      action: input.action,
      reactionType: input.reactionType,
      targetMessageId: input.targetMessageId,
    });

    logger.info({ conversationId: conversation.id, outcome: outcome.kind }, "reaction handled");

    switch (outcome.kind) {
      case "control_more":
        await this.startSearch(user, conversation, language);
        return;
      case "control_stop":
        await this.moveTo(conversation, "AWAITING_CONTACT_SELECTION");
        await this.offerShortlist(user, conversation, language);
        return;
      case "listing":
        if (outcome.decision === "liked") {
          await this.moveTo(conversation, "REVIEWING_RESULTS");
        }
        return;
      default:
        return;
    }
  }

  private async applyPositionalDecision(
    user: UserRow,
    conversation: ConversationRow,
    command: Extract<Command, { kind: "like" | "reject" }>,
    language: Language,
  ): Promise<void> {
    const batchId = conversation.activeBatchId;
    if (!batchId) {
      await this.say(
        conversation,
        language === "sv" ? "Jag har inga aktuella lägenheter att märka." : "I don't have any current apartments to mark.",
        "no-batch",
      );
      return;
    }

    const presentations = await this.repos.batches.listPresentations(batchId);
    const target = presentations[command.position - 1];
    if (!target) {
      await this.say(
        conversation,
        language === "sv" ? "Jag hittar ingen lägenhet med det numret." : "I can't find an apartment with that number.",
        "bad-position",
      );
      return;
    }

    await this.repos.decisions.record({
      userId: user.id,
      listingId: target.listingId,
      batchId,
      decision: command.kind === "like" ? "shortlisted" : "rejected",
      source: "text_command",
    });
    await this.moveTo(conversation, "REVIEWING_RESULTS");
    await this.say(
      conversation,
      command.kind === "like"
        ? language === "sv" ? `Sparad i din lista (${command.position}).` : `Saved to your shortlist (${command.position}).`
        : language === "sv" ? `Okej, jag visar inte den igen (${command.position}).` : `Got it, I won't show that one again (${command.position}).`,
      "decision-ack",
    );
  }

  // -------------------------------------------------------------- contact

  private async offerShortlist(
    user: UserRow,
    conversation: ConversationRow,
    language: Language,
  ): Promise<void> {
    const shortlist = await this.repos.decisions.listByDecision(user.id, "shortlisted");
    if (shortlist.length === 0) {
      await this.say(
        conversation,
        language === "sv"
          ? "Sökningen är pausad. Skriv FLER när du vill se fler lägenheter."
          : "Search paused. Send MORE whenever you want to see more apartments.",
        "paused-empty",
      );
      return;
    }

    const listings = await this.repos.listings.findManyById(shortlist.map((d) => d.listingId));
    const lines = listings.map((listing, index) => `${index + 1}. ${listing.title}`).join("\n");
    await this.repos.conversations.mergePayload(conversation.id, {
      pendingContactListingIds: listings.map((l) => l.id),
    });
    await this.say(
      conversation,
      language === "sv"
        ? `Du har ${listings.length} sparade lägenheter:\n\n${lines}\n\nSkriv KONTAKTA 1 för att förbereda ett meddelande.`
        : `You have ${listings.length} saved apartments:\n\n${lines}\n\nSend CONTACT 1 to prepare a message.`,
      "shortlist",
    );
  }

  private async beginContact(
    user: UserRow,
    conversation: ConversationRow,
    positions: number[],
    language: Language,
  ): Promise<void> {
    const payload = this.payload(conversation);
    const pool =
      payload.pendingContactListingIds ??
      (conversation.activeBatchId
        ? (await this.repos.batches.listPresentations(conversation.activeBatchId)).map((p) => p.listingId)
        : []);

    const listingIds = positions
      .map((position) => pool[position - 1])
      .filter((id): id is string => typeof id === "string");

    if (listingIds.length === 0) {
      await this.say(
        conversation,
        language === "sv" ? "Jag hittar ingen lägenhet med det numret." : "I can't find an apartment with that number.",
        "contact-bad-position",
      );
      return;
    }

    await this.repos.conversations.mergePayload(conversation.id, { pendingContactListingIds: listingIds });
    await this.moveTo(conversation, "AWAITING_CONTACT_SELECTION");
    await this.requestContactDetailsOrDraft(user, conversation, language);
  }

  private async beginContactAllLiked(
    user: UserRow,
    conversation: ConversationRow,
    language: Language,
  ): Promise<void> {
    const shortlist = await this.repos.decisions.listByDecision(user.id, "shortlisted");
    if (shortlist.length === 0) {
      await this.say(
        conversation,
        language === "sv" ? "Du har inga sparade lägenheter ännu." : "You don't have any saved apartments yet.",
        "no-shortlist",
      );
      return;
    }
    await this.repos.conversations.mergePayload(conversation.id, {
      pendingContactListingIds: shortlist.map((d) => d.listingId),
    });
    await this.moveTo(conversation, "AWAITING_CONTACT_SELECTION");
    await this.requestContactDetailsOrDraft(user, conversation, language);
  }

  /** Contact details are only ever requested at this point, never during onboarding. */
  private async requestContactDetailsOrDraft(
    user: UserRow,
    conversation: ConversationRow,
    language: Language,
  ): Promise<void> {
    const fresh = await this.repos.users.findById(user.id);
    if (!fresh) return;
    const missing = missingContactDetails(fresh);

    if (!hasAllContactDetails(missing)) {
      const field = missing.fullName ? "fullName" : missing.email ? "email" : "phone";
      await this.repos.conversations.mergePayload(conversation.id, { awaitingContactField: field });
      await this.moveTo(conversation, "AWAITING_CONTACT_DETAILS");
      await this.say(conversation, this.contactFieldPrompt(field, language), `ask-${field}`);
      return;
    }

    await this.draftAndOfferReview(fresh, conversation, language);
  }

  private async captureContactDetail(
    user: UserRow,
    conversation: ConversationRow,
    text: string,
    language: Language,
  ): Promise<void> {
    const field = this.payload(conversation).awaitingContactField;
    const value = text.trim();

    if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      await this.say(conversation, language === "sv" ? "Det ser inte ut som en giltig e-postadress. Försök igen." : "That doesn't look like a valid email address. Please try again.", "bad-email");
      return;
    }
    if (field === "phone" && !/^\+?[\d\s-]{6,}$/.test(value)) {
      await this.say(conversation, language === "sv" ? "Det ser inte ut som ett giltigt telefonnummer. Försök igen." : "That doesn't look like a valid phone number. Please try again.", "bad-phone");
      return;
    }

    const patch =
      field === "fullName" ? { fullName: value }
      : field === "email" ? { email: value }
      : { contactPhone: value };
    await this.repos.users.update(user.id, { ...patch, consentToShareContactDetails: true });
    await this.repos.conversations.mergePayload(conversation.id, { awaitingContactField: undefined });
    await this.requestContactDetailsOrDraft(user, conversation, language);
  }

  private async draftAndOfferReview(
    user: UserRow,
    conversation: ConversationRow,
    language: Language,
  ): Promise<void> {
    const listingIds = this.payload(conversation).pendingContactListingIds ?? [];
    const listingId = listingIds[0];
    if (!listingId) return;

    const application = await this.applications.createDraft({
      userId: user.id,
      listingId,
      language,
    });
    await this.moveTo(conversation, "AWAITING_CONTACT_CONFIRMATION");

    const url = `${env.BASE_URL}/applications/${application.id}/review`;
    await this.say(
      conversation,
      language === "sv"
        ? `Jag har förberett ett meddelande till hyresvärden. Läs igenom och bekräfta här:\n${url}`
        : `I've prepared a message to the landlord. Review and confirm it here:\n${url}`,
      "application-review",
    );
  }

  // -------------------------------------------------------- rental & data

  private async captureLeaseDates(
    user: UserRow,
    conversation: ConversationRow,
    text: string,
    language: Language,
  ): Promise<void> {
    const dates = text.match(/(\d{4}-\d{2}-\d{2})/g);
    if (!dates || dates.length < 2) {
      await this.say(
        conversation,
        language === "sv"
          ? "Skriv start- och slutdatum, till exempel: 2026-09-01 till 2027-06-30."
          : "Please send the start and end dates, for example: 2026-09-01 to 2027-06-30.",
        "lease-dates-retry",
      );
      return;
    }

    const [startsAt, endsAt] = dates as [string, string];
    const renewalSearchAt = new Date(
      new Date(`${endsAt}T00:00:00.000Z`).getTime() - env.RENEWAL_LEAD_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    await this.repos.leases.create({
      userId: user.id,
      startsAt: `${startsAt}T00:00:00.000Z`,
      endsAt: `${endsAt}T00:00:00.000Z`,
      renewalSearchAt,
      status: "active",
    });

    await this.say(
      conversation,
      language === "sv"
        ? `Sparat. Jag hör av mig omkring ${renewalSearchAt.slice(0, 10)} inför nästa sökning.`
        : `Saved. I'll check in around ${renewalSearchAt.slice(0, 10)} before your next search.`,
      "lease-saved",
    );
  }

  private async resetProfile(
    user: UserRow,
    conversation: ConversationRow,
    language: Language,
  ): Promise<void> {
    await this.repos.conversations.patch(conversation.id, {
      statePayload: "{}",
      activeBatchId: null,
      currentState: "NEW",
    });
    await this.repos.users.update(user.id, { acceptedUniversityId: null, selectedCampusId: null });
    await this.say(
      conversation,
      language === "sv" ? "Vi börjar om. Vilket universitet har du kommit in på?" : "Let's start over. Which university were you accepted to?",
      "reset",
    );
  }

  private async deleteUserData(
    user: UserRow,
    conversation: ConversationRow,
    language: Language,
  ): Promise<void> {
    await this.repos.decisions.deleteForUser(user.id);
    await this.repos.viewEvents.deleteForUser(user.id);
    await this.repos.users.anonymise(user.id);

    await this.say(
      conversation,
      language === "sv"
        ? "Klart. Dina uppgifter är raderade och jag slutar söka. Skriv HEJ om du vill börja om."
        : "Done. Your data has been deleted and I've stopped searching. Send HI if you ever want to start again.",
      "deleted",
    );

    // Wiped last so the closing message above — which itself lands in
    // recentTurns via say() — is cleared along with everything older.
    await this.repos.conversations.patch(conversation.id, {
      statePayload: "{}",
      activeBatchId: null,
      currentState: "OPTED_OUT",
    });
    logger.info({ userId: user.id }, "user data deleted on request");
  }

  // ---------------------------------------------------------------- utils

  private matchChoice(
    text: string,
    choices: { id: string; name: string }[],
  ): { id: string; name: string } | null {
    const trimmed = text.trim().toLowerCase();
    const index = Number(trimmed);
    if (Number.isInteger(index) && index >= 1 && index <= choices.length) {
      return choices[index - 1] ?? null;
    }
    return choices.find((choice) => trimmed.includes(choice.name.toLowerCase())) ?? null;
  }

  private contactFieldPrompt(field: "fullName" | "email" | "phone", language: Language): string {
    const prompts = {
      fullName: {
        en: "What is your full name? The landlord will see it.",
        sv: "Vad heter du i fullt namn? Hyresvärden kommer att se det.",
      },
      email: {
        en: "What email address should the landlord reply to?",
        sv: "Vilken e-postadress ska hyresvärden svara till?",
      },
      phone: {
        en: "What phone number can the landlord reach you on?",
        sv: "Vilket telefonnummer kan hyresvärden nå dig på?",
      },
    } as const;
    return prompts[field][language];
  }

  private helpText(language: Language): string {
    return language === "sv"
      ? [
          "Du kan skriva:",
          "SÖK — starta sökningen",
          "FLER — tre nya lägenheter",
          "GILLA 1 / NEJ 2 — spara eller dölj",
          "KONTAKTA 1 — förbered ett meddelande",
          "PAUSA / FORTSÄTT",
          "RADERA MINA UPPGIFTER",
        ].join("\n")
      : [
          "You can send:",
          "SEARCH — start searching",
          "MORE — three new apartments",
          "LIKE 1 / REJECT 2 — save or hide",
          "CONTACT 1 — prepare a message",
          "PAUSE / RESUME",
          "DELETE MY DATA",
        ].join("\n");
  }
}
