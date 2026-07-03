import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OAuthController } from "../../../src/api/controllers/v1/oauth/oauth.controller";
import { OAuthAuthorizationService, OAuthProtocolError } from "../../../src/services/oauth/oauth-authorization.service";

describe("OAuthController token endpoint", () => {
  const oauthServiceMock = {
    exchangeToken: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(OAuthAuthorizationService, "getInstance").mockReturnValue(
      oauthServiceMock as unknown as OAuthAuthorizationService,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns RFC-style OAuth error payloads without success dto shape", async () => {
    oauthServiceMock.exchangeToken.mockRejectedValue(
      new OAuthProtocolError(401, "invalid_client", "Client authentication failed"),
    );

    const controller = new OAuthController();
    const request = { res: { locals: {} } } as any;

    const result = await controller.token(request, {
      grant_type: "refresh_token",
      refresh_token: "ort_test",
    });

    expect(request.res.locals.skipResponseWrapper).toBe(true);
    expect(controller.getStatus()).toBe(401);
    expect(result).toEqual({
      error: "invalid_client",
      error_description: "Client authentication failed",
    });
  });
});
