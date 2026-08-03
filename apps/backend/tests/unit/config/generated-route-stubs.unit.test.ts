import * as routePaths from "@/build/route-paths";
import { expect, it } from "vitest";

it("uses generated route stubs in the backend-unit project", () => {
  expect((routePaths as Record<string, unknown>).UNIT_TEST_ROUTE_STUB).toBe(true);
});
