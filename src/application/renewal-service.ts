import type { Repositories } from "../database/repositories/index.js";
import type { LinqAdapter } from "../integrations/linq/linq-client.js";
import { idempotencyKeys } from "../utils/ids.js";
import { logger } from "../utils/logger.js";
import type { Language } from "../domain/entities.js";

export interface RenewalRunResult {
  checked: number;
  remindersSent: number;
  skipped: number;
}

export class RenewalService {
  constructor(
    private readonly repos: Repositories,
    private readonly linq: LinqAdapter,
  ) {}

  /**
   * Nudges users whose lease is approaching its end. Never starts a search or
   * sends an application on its own — it only asks whether anything changed.
   */
  async run(asOf: Date = new Date()): Promise<RenewalRunResult> {
    const due = await this.repos.leases.findDueForRenewal(asOf);
    let remindersSent = 0;
    let skipped = 0;

    for (const lease of due) {
      const user = await this.repos.users.findById(lease.userId);
      if (!user || user.deletedAt) {
        skipped += 1;
        continue;
      }

      const conversation = await this.repos.conversations.findByUserId(lease.userId);
      if (!conversation) {
        skipped += 1;
        continue;
      }

      const language = (user.preferredLanguage as Language) ?? "en";
      const endsAt = lease.endsAt?.slice(0, 10) ?? "";

      await this.linq.sendText({
        chatId: conversation.linqChatId,
        conversationId: conversation.id,
        text:
          language === "sv"
            ? `Din hyresperiod slutar ${endsAt}. Vill du att jag börjar söka igen? Har budget, område eller restid ändrats?`
            : `Your rental ends on ${endsAt}. Would you like me to start searching again? Have your budget, area or commute changed?`,
        // Keyed on the lease so a re-run of the job cannot double-message.
        idempotencyKey: `housing:${lease.id}:renewal-reminder`,
      });

      await this.repos.leases.markReminded(lease.id);
      remindersSent += 1;
    }

    logger.info({ checked: due.length, remindersSent, skipped }, "renewal check completed");
    return { checked: due.length, remindersSent, skipped };
  }

}

export { idempotencyKeys };
