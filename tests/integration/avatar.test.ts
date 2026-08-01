import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

describe("GET /avatar.png", () => {
  it("serves the embedded contact-card avatar as a PNG", async () => {
    const { app } = createApp();
    const res = await app.request("/avatar.png");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual(PNG_SIGNATURE);
  });

  it("sets a public, cacheable response since Linq fetches it cross-origin", async () => {
    const { app } = createApp();
    const res = await app.request("/avatar.png");

    expect(res.headers.get("cache-control")).toContain("public");
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
  });
});
