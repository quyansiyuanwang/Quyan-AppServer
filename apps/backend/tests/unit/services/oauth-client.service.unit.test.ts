import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperationCategory, OperationType } from "../../../src/constant/operation-type";
import { BadRequestError } from "../../../src/util/errors";
import { OAuthClientService } from "../../../src/services/users/oauth-client.service";

const now = new Date("2026-06-02T12:00:00.000Z");

const createClientRecord = (overrides: Record<string, unknown> = {}) => ({
  id: "oauth-client-1",
  userId: "user-1",
  reviewedByUserId: null,
  name: "Example App",
  description: "desc",
  clientId: "oauth_client_id",
  clientSecretHash: "secret-hash",
  clientSecretPreview: "oauths_ab****1234",
  clientType: "confidential",
  reviewStatus: "draft",
  reviewComment: null,
  submittedAt: null,
  reviewedAt: null,
  grantTypes: ["authorization_code", "refresh_token"],
  redirectUris: ["https://example.com/callback"],
  scopes: ["profile"],
  homepageUrl: null,
  logoUrl: null,
  policyUrl: null,
  tosUrl: null,
  isPkceRequired: true,
  accessTokenLifetime: 3600,
  refreshTokenLifetime: 2592000,
  lastUsedAt: null,
  createTime: now,
  updateTime: now,
  status: 1,
  ...overrides,
});

describe("OAuthClientService review workflow", () => {
  const repository = {
    create: vi.fn(),
    findById: vi.fn(),
    findByUserId: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findReviewList: vi.fn(),
  };

  const businessLogService = {
    logOperation: vi.fn(),
  };

  const OAuthClientServiceCtor = OAuthClientService as unknown as new (
    repo: typeof repository,
    logService: typeof businessLogService,
  ) => OAuthClientService;

  const service = new OAuthClientServiceCtor(repository as any, businessLogService as any);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resets rejected client back to draft after owner edits", async () => {
    const existing = createClientRecord({
      reviewStatus: "rejected",
      reviewComment: "Need more details",
      submittedAt: now,
      reviewedAt: now,
      reviewedByUserId: "reviewer-1",
    });
    repository.findById.mockResolvedValue(existing);
    repository.update.mockImplementation(async (_id: string, data: Record<string, unknown>) => ({
      ...existing,
      ...data,
      updateTime: now,
    }));

    const result = await service.updateClient("oauth-client-1", "user-1", {
      name: "  Updated App  ",
    });

    expect(repository.update).toHaveBeenCalledWith(
      "oauth-client-1",
      expect.objectContaining({
        name: "Updated App",
        reviewStatus: "draft",
        reviewComment: null,
        submittedAt: null,
        reviewedAt: null,
        reviewedByUserId: null,
      }),
    );
    expect(result.reviewStatus).toBe("draft");
    expect(result.reviewComment).toBeUndefined();
  });

  it("records reject review comment and audit log", async () => {
    const existing = createClientRecord({
      reviewStatus: "pending",
      reviewComment: null,
      submittedAt: now,
    });
    repository.findById.mockResolvedValue(existing);
    repository.update.mockImplementation(async (_id: string, data: Record<string, unknown>) => ({
      ...existing,
      ...data,
      reviewedAt: now,
      reviewedByUserId: "reviewer-1",
      updateTime: now,
    }));

    const result = await service.reviewClient("oauth-client-1", "reviewer-1", {
      reviewStatus: "rejected",
      reviewComment: "  malicious behavior detected  ",
    });

    expect(repository.update).toHaveBeenCalledWith(
      "oauth-client-1",
      expect.objectContaining({
        reviewStatus: "rejected",
        reviewComment: "malicious behavior detected",
        reviewedByUserId: "reviewer-1",
      }),
    );
    expect(result.reviewStatus).toBe("rejected");
    expect(result.reviewComment).toBe("malicious behavior detected");
    expect(businessLogService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: OperationType.OAUTH_CLIENT_REVIEW_REJECT,
        operationCategory: OperationCategory.AUTH,
        actorUserId: "reviewer-1",
        targetUserId: "user-1",
        targetResourceId: "oauth-client-1",
        success: true,
      }),
    );
  });

  it("allows review-side deletion for approved clients", async () => {
    const existing = createClientRecord({
      reviewStatus: "approved",
      reviewComment: "approved before",
    });
    repository.findById.mockResolvedValue(existing);
    repository.delete.mockResolvedValue({
      ...existing,
      status: 0,
    });

    await expect(service.deleteClientForReview("oauth-client-1", "reviewer-1")).resolves.toBeUndefined();

    expect(repository.delete).toHaveBeenCalledWith("oauth-client-1");
    expect(businessLogService.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: OperationType.OAUTH_CLIENT_DELETE,
        operationCategory: OperationCategory.AUTH,
        actorUserId: "reviewer-1",
        targetUserId: "user-1",
        targetResourceId: "oauth-client-1",
        changes: { reviewStatus: "approved" },
        success: true,
      }),
    );
  });

  it("still blocks reviewing non-pending clients", async () => {
    repository.findById.mockResolvedValue(createClientRecord({ reviewStatus: "approved" }));

    await expect(
      service.reviewClient("oauth-client-1", "reviewer-1", {
        reviewStatus: "approved",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);

    expect(repository.update).not.toHaveBeenCalled();
  });
});
