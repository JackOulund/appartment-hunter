import LinqAPIV3 from "@linqapp/sdk";
import { config } from "./config.js";

/**
 * `webhookSecret` is what `client.webhooks.unwrap()` verifies signatures against.
 * The SDK reads both values from the environment too, but passing them keeps
 * the failure mode at startup rather than on the first webhook.
 */
export const linq = new LinqAPIV3({
  apiKey: config.linqApiKey,
  webhookSecret: config.linqWebhookSecret,
});
