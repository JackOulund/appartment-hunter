import { randomUUID, createHash } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Outbound Linq calls are keyed so a webhook retry or a crashed-then-restarted
 * batch cannot double-send a message.
 */
export const idempotencyKeys = {
  welcome: (conversationId: string) => `housing:${conversationId}:welcome`,
  listingSummary: (batchId: string, listingId: string) => `housing:${batchId}:${listingId}:summary`,
  listingMedia: (batchId: string, listingId: string) => `housing:${batchId}:${listingId}:media`,
  listingLink: (batchId: string, listingId: string) => `housing:${batchId}:${listingId}:link`,
  batchIntro: (batchId: string) => `housing:${batchId}:intro`,
  batchControl: (batchId: string) => `housing:${batchId}:control`,
  contact: (applicationId: string) => `housing:${applicationId}:contact`,
  ad_hoc: (conversationId: string, tag: string) => `housing:${conversationId}:${tag}`,
} as const;
