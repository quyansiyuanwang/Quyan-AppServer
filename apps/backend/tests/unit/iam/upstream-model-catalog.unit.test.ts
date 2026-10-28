import { describe, expect, it, vi } from "vitest";
import { getIamActionDefinition, Permission } from "@quyan/shared";
vi.mock("@/build/iam-action-routes", () => ({
  IAM_ACTION_ROUTES: { "quyan:relay:ListUpstreamModels": ["POST /v1/relay-channels/upstream-models"] },
}));
import { IamCatalogService } from "@/iam/iam-catalog.service";
describe("mixed-scope upstream model action catalog", () => {
  it("cannot mutate shared eligibility or compatibility metadata via API result arrays", () => {
    const catalog = IamCatalogService.getInstance(),
      action = "quyan:relay:ListUpstreamModels";
    const row = catalog.listActions("relay").find((row) => row.action === action)!;
    expect(row.platformPermissions).toEqual([Permission.RELAY_CHANNEL_REVIEW, Permission.RELAY_CHANNEL_UPDATE]);
    row.platformPermissions!.length = 0;
    row.legacyPermissions!.length = 0;
    row.apiRoutes.length = 0;
    expect(getIamActionDefinition(action)!.platformPermissions).toEqual([
      Permission.RELAY_CHANNEL_REVIEW,
      Permission.RELAY_CHANNEL_UPDATE,
    ]);
    expect(catalog.listActions("relay").find((row) => row.action === action)!.legacyPermissions).toHaveLength(3);
    expect(catalog.listActions("relay").find((row) => row.action === action)!.apiRoutes).toHaveLength(1);
  });
});
