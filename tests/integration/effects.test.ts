import { describe, expect, it } from "vitest";
import { completeOnboarding, createHarness } from "../helpers/harness.js";

describe("confetti screen effect on the university congratulations", () => {
  it("fires the confetti screen effect only on the congrats message", async () => {
    const h = await createHarness();
    await h.say("I got accepted to Lund University");

    const withEffect = h.linq.sent.filter((m) => m.effect);
    expect(withEffect).toHaveLength(1);
    expect(withEffect[0]?.effect).toEqual({ name: "confetti", type: "screen" });
    expect(withEffect[0]?.body).toContain("Congratulations");
  });

  it("is the only message in the whole onboarding transcript carrying any effect", async () => {
    const h = await createHarness();
    await completeOnboarding(h);

    const withEffect = h.linq.sent.filter((m) => m.effect);
    expect(withEffect).toHaveLength(1);
    expect(withEffect[0]?.body).toContain("Congratulations");
  });
});
