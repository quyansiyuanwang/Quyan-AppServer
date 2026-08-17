import { describe, expect, it, vi } from "vitest";
import { AuthService } from "@/services/auth/auth.service";

describe("AuthService refresh impersonation handoff", () => {
  const createRequest = () => {
    const clearCookie = vi.fn();
    return {
      request: { headers: {}, res: { clearCookie } } as never,
      clearCookie,
    };
  };

  it("restores a valid cross-site impersonation handoff within the refresh request", async () => {
    const { request, clearCookie } = createRequest();
    const restoreImpersonation = vi.fn().mockResolvedValue({
      access_token: "impersonation-access-token",
      expires_in: 3600,
      targetUser: { id: "target-user", username: "target", name: "Target User" },
      mode: "view" as const,
    });
    const authService = new AuthService();
    (authService as any).impersonationService = { restoreImpersonation };

    await expect(authService.refresh(request)).resolves.toEqual({
      access_token: "impersonation-access-token",
      impersonation: {
        targetUser: { id: "target-user", username: "target", name: "Target User" },
        mode: "view",
      },
    });
    expect(restoreImpersonation).toHaveBeenCalledWith(request);
    expect(clearCookie).not.toHaveBeenCalled();
  });

  it("skips and clears the handoff when explicitly exiting impersonation", async () => {
    const { request, clearCookie } = createRequest();
    const restoreImpersonation = vi.fn();
    const authService = new AuthService();
    (authService as any).impersonationService = { restoreImpersonation };

    await expect(authService.refresh(request, undefined, true)).rejects.toThrow("缺少刷新令牌");
    expect(restoreImpersonation).not.toHaveBeenCalled();
    expect(clearCookie).toHaveBeenCalledOnce();
  });
});
