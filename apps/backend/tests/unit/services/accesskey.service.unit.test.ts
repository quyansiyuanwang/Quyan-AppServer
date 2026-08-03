import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessKeyService } from "../../../src/services/users/accesskey.service";
import { BadRequestError } from "../../../src/util/errors";
import { CustomCode } from "../../../src/constant/custom-code";

const createService = () => {
  const accessKeyRepositoryMock = {
    create: vi.fn().mockImplementation(async (data: any) => ({
      id: "ak-1",
      userId: data.userId,
      name: data.name,
      key: data.key,
      expiresAt: data.expiresAt ?? null,
      lastUsedAt: null,
      requestCount: 0,
      createTime: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    })),
    findByKey: vi.fn(),
    update: vi.fn(),
    findByUserId: vi.fn(),
    findById: vi.fn(),
    delete: vi.fn(),
  };

  const userRepositoryMock = {
    findById: vi.fn(),
  };

  const emailServiceMock = {
    verifyCode: vi.fn(),
    sendVerificationCode: vi.fn(),
  };
  const businessLogServiceMock = {
    logOperation: vi.fn(),
  };

  const service = new AccessKeyService(
    accessKeyRepositoryMock as any,
    userRepositoryMock as any,
    emailServiceMock as any,
    businessLogServiceMock as any,
  );

  return {
    service,
    mocks: {
      accessKeyRepositoryMock,
      userRepositoryMock,
      emailServiceMock,
      businessLogServiceMock,
    },
  };
};

describe("AccessKeyService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips email code verification when user has 2FA enabled", async () => {
    const { service, mocks } = createService();
    mocks.userRepositoryMock.findById.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      twoFactorEnabled: true,
    });

    const result = await service.generateKeyForUser("user-1", {
      name: "primary",
    });

    expect(mocks.emailServiceMock.verifyCode).not.toHaveBeenCalled();
    expect(mocks.accessKeyRepositoryMock.create).toHaveBeenCalledTimes(1);
    expect(result.key.startsWith("ak_")).toBe(true);
    expect(mocks.businessLogServiceMock.logOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: "ACCESS_KEY_CREATE",
        actorUserId: "user-1",
      }),
    );
  });

  it("requires verification code when user does not have 2FA enabled", async () => {
    const { service, mocks } = createService();
    mocks.userRepositoryMock.findById.mockResolvedValue({
      id: "user-2",
      email: "no2fa@example.com",
      twoFactorEnabled: false,
    });

    await expect(
      service.generateKeyForUser("user-2", {
        name: "secondary",
      }),
    ).rejects.toMatchObject({
      message: "验证码无效或已过期",
      code: CustomCode.VERIFICATION_CODE_INVALID,
    });

    expect(mocks.emailServiceMock.verifyCode).not.toHaveBeenCalled();
  });

  it("validates verification code when user does not have 2FA enabled", async () => {
    const { service, mocks } = createService();
    mocks.userRepositoryMock.findById.mockResolvedValue({
      id: "user-3",
      email: "verify@example.com",
      twoFactorEnabled: false,
    });
    mocks.emailServiceMock.verifyCode.mockResolvedValue(false);

    await expect(
      service.generateKeyForUser("user-3", {
        verificationCode: " 123456 ",
      }),
    ).rejects.toBeInstanceOf(BadRequestError);

    expect(mocks.emailServiceMock.verifyCode).toHaveBeenCalledWith("verify@example.com", "123456");
  });

  it("does not send email verification code when user already enabled 2FA", async () => {
    const { service, mocks } = createService();
    mocks.userRepositoryMock.findById.mockResolvedValue({
      id: "user-4",
      email: "enabled@example.com",
      twoFactorEnabled: true,
    });

    const sent = await service.sendAccessKeyCreationVerificationCodeForUser("user-4");

    expect(sent).toBe(false);
    expect(mocks.emailServiceMock.sendVerificationCode).not.toHaveBeenCalled();
  });

  it("sends email verification code when user has not enabled 2FA", async () => {
    const { service, mocks } = createService();
    mocks.userRepositoryMock.findById.mockResolvedValue({
      id: "user-5",
      email: "disabled@example.com",
      twoFactorEnabled: false,
    });
    mocks.emailServiceMock.sendVerificationCode.mockResolvedValue(undefined);

    const sent = await service.sendAccessKeyCreationVerificationCodeForUser("user-5");

    expect(sent).toBe(true);
    expect(mocks.emailServiceMock.sendVerificationCode).toHaveBeenCalledWith("disabled@example.com");
  });
});
