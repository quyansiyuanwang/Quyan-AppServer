import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { terminalInstallTargetFingerprint } from "@/iam/resources/terminal-install-capability";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { iamAccountDenied } from "../users/iam-account-principal";
import { assertTerminalInstallCredential } from "./terminal-install-credential";
import { ConflictError } from "@/util/errors";
import type {
  TerminalInstallRegistrationGuard,
  TerminalInstallRegistrationInput,
  TerminalInstallRegistrationStore,
} from "./terminal-install-registration.store";
/** The entitlement lock serializes slot checks and writes, including reactivation of disabled bindings. */
export class TerminalInstallRegistrationRepository implements TerminalInstallRegistrationStore {
  private static instance: TerminalInstallRegistrationRepository;
  static getInstance() {
    return (this.instance ??= new TerminalInstallRegistrationRepository());
  }
  async register(input: TerminalInstallRegistrationInput, guard: TerminalInstallRegistrationGuard) {
    const capability = guard.capability,
      principal = capability.grant.principal;
    if (
      guard.users.targetUserId !== principal.subjectUserId ||
      guard.users.principal !== principal ||
      !/^[a-f0-9]{64}$/.test(input.fingerprint) ||
      !/^[a-z0-9]+(?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(input.fingerprintVersion) ||
      !Number.isFinite(input.cooldownMinutes) ||
      input.cooldownMinutes < 0
    )
      throw iamAccountDenied();
    try {
      return await prisma.$transaction(
        async (tx) => {
          await assertIamAccountUserMutation(tx, guard.users, principal.subjectUserId);
          await assertTerminalInstallCredential(tx, principal, capability.grant.accessKeyId);
          const revision = await readIamAuthorizationRevision(tx, principal.accountOwnerId);
          await tx.$queryRaw`SELECT id FROM remote_terminal_user_entitlements WHERE id=${capability.entitlementId} FOR UPDATE`;
          const now = new Date();
          const target = await tx.remoteTerminalUserEntitlement.findFirst({
            where: {
              id: capability.entitlementId,
              userId: principal.subjectUserId,
              status: 1,
              startAt: { lte: now },
              endAt: { gte: now },
            },
            select: {
              id: true,
              userId: true,
              status: true,
              deviceLimit: true,
              endAt: true,
              updateTime: true,
              registrationToken: { select: { id: true, status: true, expiresAt: true } },
            },
          });
          const token = target?.registrationToken;
          if (
            !target ||
            target.id !== capability.entitlementId ||
            target.userId !== principal.subjectUserId ||
            target.deviceLimit <= 0 ||
            !token ||
            token.status !== 1 ||
            (token.expiresAt && token.expiresAt.getTime() <= now.getTime()) ||
            terminalInstallTargetFingerprint(target) !== capability.grant.targetFingerprint
          )
            throw iamAccountDenied();
          const existing = await tx.remoteTerminalDeviceBinding.findFirst({
            where: { entitlementId: target.id, fingerprint: input.fingerprint },
            select: {
              id: true,
              deviceId: true,
              userId: true,
              fingerprint: true,
              status: true,
              updateTime: true,
            },
          });
          if (
            existing &&
            (existing.userId !== target.userId ||
              existing.fingerprint !== input.fingerprint ||
              ![-1, 0, 1].includes(existing.status))
          )
            throw iamAccountDenied();
          if (
            existing?.status === -1 &&
            existing.updateTime.getTime() + input.cooldownMinutes * 60 * 1000 > now.getTime()
          )
            throw new Error("Device rebind is cooling down.");
          if (!existing || existing.status !== 1) {
            const used = await tx.remoteTerminalDeviceBinding.count({ where: { entitlementId: target.id, status: 1 } });
            if (used >= target.deviceLimit) throw new Error("Device limit reached for this entitlement.");
          }
          const deviceId = existing?.deviceId ?? randomUUID(),
            heartbeatToken = randomUUID();
          const data = {
            entitlementId: target.id,
            userId: target.userId,
            registrationTokenId: token.id,
            heartbeatToken,
            fingerprint: input.fingerprint,
            fingerprintVersion: input.fingerprintVersion,
            hostname: input.snapshot.hostname,
            platform: input.snapshot.platform,
            arch: input.snapshot.arch,
            snapshot: input.snapshot as unknown as Prisma.InputJsonValue,
            lastSeenAt: now,
            online: false,
            status: 1,
          };
          if (existing) await tx.remoteTerminalDeviceBinding.update({ where: { id: existing.id }, data });
          else await tx.remoteTerminalDeviceBinding.create({ data: { ...data, deviceId, registeredAt: now } });
          await tx.remoteTerminalEntitlementToken.update({ where: { id: token.id }, data: { lastUsedAt: now } });
          await assertIamAccountUserMutation(tx, guard.users, principal.subjectUserId);
          await assertTerminalInstallCredential(tx, principal, capability.grant.accessKeyId);
          if ((await readIamAuthorizationRevision(tx, principal.accountOwnerId)) !== revision) throw iamAccountDenied();
          const finishedAt = Date.now();
          if (target.endAt.getTime() <= finishedAt || (token.expiresAt && token.expiresAt.getTime() <= finishedAt))
            throw iamAccountDenied();
          return { deviceId, heartbeatToken, acceptedAt: now.toISOString() };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Installation authorization or device capacity changed", undefined, {
          messageKey: "errors.conflict",
        });
      throw error;
    }
  }
}
