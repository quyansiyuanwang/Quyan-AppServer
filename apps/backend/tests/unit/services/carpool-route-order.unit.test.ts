import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("carpool controller route order", () => {
  it("registers the static delivery-channel endpoint before the order-id route", () => {
    // Unit CI does not generate TSOA artifacts. Check source order here and the generated router in the contract suite.
    const routes = readFileSync(
      new URL("../../../src/api/controllers/v1/billing/carpool.controller.ts", import.meta.url),
      "utf8",
    );
    const staticIndex = routes.indexOf('@Get("admin/delivery-channels")');
    const dynamicIndex = routes.indexOf('@Get("admin/{id}")');
    expect(staticIndex).toBeGreaterThan(-1);
    expect(dynamicIndex).toBeGreaterThan(staticIndex);
  });
});
