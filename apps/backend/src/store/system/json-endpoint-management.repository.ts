import { MANAGED_STATUS, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { ForbiddenError } from "@/util/errors";
import type {
  JsonEndpointManagementStore,
  JsonEndpointTarget,
  JsonEndpointOwnerTarget,
} from "./json-endpoint-management.store";
export const jsonEndpointDenied = () =>
  new ForbiddenError("JSON Endpoint resource unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });
const targetSelect = { id: true, userId: true, createTime: true, updateTime: true } as const;
const publicSelect = {
  ...targetSelect,
  status: true,
  developerProductInstanceId: true,
  name: true,
  slug: true,
  isRootSlug: true,
  rootSlug: true,
  description: true,
  jsonContent: true,
  apiKey: true,
  isPublic: true,
  accessMode: true,
  publicKey: true,
  publicKeyFingerprint: true,
  signatureAlgorithm: true,
  accessCount: true,
  lastAccessAt: true,
  user: { select: { username: true } },
} as const;
function accountUsers(accountOwnerId: string) {
  return { status: MANAGED_STATUS.ENABLED, OR: [{ accountOwnerId }, { id: accountOwnerId, accountOwnerId: null }] };
}
function afterRow(after?: { id: string; createTime: Date }) {
  return after
    ? { OR: [{ createTime: { lt: after.createTime } }, { createTime: after.createTime, id: { lt: after.id } }] }
    : {};
}
export class JsonEndpointManagementRepository implements JsonEndpointManagementStore {
  private static instance: JsonEndpointManagementRepository;
  static getInstance() {
    return (this.instance ??= new JsonEndpointManagementRepository());
  }
  async assertActor(principal: IamPrincipal) {
    if (principal.subjectUserId !== principal.principalUserId) throw jsonEndpointDenied();
    const [actor, owner] = await Promise.all([
      prisma.user.findFirst({
        where: { ...accountUsers(principal.accountOwnerId), id: principal.subjectUserId },
        select: { id: true },
      }),
      prisma.user.findFirst({
        where: { ...accountUsers(principal.accountOwnerId), id: principal.accountOwnerId },
        select: { id: true },
      }),
    ]);
    if (!actor || !owner) throw jsonEndpointDenied();
    if (principal.subjectType === "assumed_role" || principal.assumedRoleId || principal.roleSessionId) {
      if (principal.subjectType !== "assumed_role" || !principal.assumedRoleId || !principal.roleSessionId)
        throw jsonEndpointDenied();
      const session = await prisma.ramRoleSession.findFirst({
        where: {
          id: principal.roleSessionId,
          subjectUserId: actor.id,
          accountOwnerId: principal.accountOwnerId,
          roleId: principal.assumedRoleId,
          status: MANAGED_STATUS.ENABLED,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          role: {
            id: principal.assumedRoleId,
            accountOwnerId: principal.accountOwnerId,
            status: MANAGED_STATUS.ENABLED,
          },
        },
        select: { id: true },
      });
      if (!session) throw jsonEndpointDenied();
    }
  }
  async assertOwner(principal: IamPrincipal, userId: string) {
    await this.assertActor(principal);
    if (
      !(await prisma.user.findFirst({
        where: { ...accountUsers(principal.accountOwnerId), id: userId },
        select: { id: true },
      }))
    )
      throw jsonEndpointDenied();
  }
  async scan(principal: IamPrincipal, ownerUserId?: string, after?: JsonEndpointTarget) {
    await this.assertActor(principal);
    return prisma.jsonEndpoint.findMany({
      where: {
        status: MANAGED_STATUS.ENABLED,
        user: accountUsers(principal.accountOwnerId),
        ...(ownerUserId ? { userId: ownerUserId } : {}),
        ...afterRow(after),
      },
      select: targetSelect,
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
  }
  async target(principal: IamPrincipal, id: string) {
    await this.assertActor(principal);
    return prisma.jsonEndpoint.findFirst({
      where: { id, status: MANAGED_STATUS.ENABLED, user: accountUsers(principal.accountOwnerId) },
      select: targetSelect,
    });
  }
  async hydrate(principal: IamPrincipal, targets: readonly JsonEndpointTarget[]) {
    await this.assertActor(principal);
    if (!targets.length) return [];
    if (targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) throw jsonEndpointDenied();
    const rows = await prisma.jsonEndpoint.findMany({
      where: {
        status: MANAGED_STATUS.ENABLED,
        user: accountUsers(principal.accountOwnerId),
        OR: targets.map((t) => ({ id: t.id, userId: t.userId, updateTime: t.updateTime })),
      },
      select: publicSelect,
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
    });
    return rows.map(({ apiKey, user, ...row }) => ({ ...row, hasPassword: !!apiKey, ownerUsername: user.username }));
  }
  async scanOwners(principal: IamPrincipal, after?: JsonEndpointOwnerTarget) {
    await this.assertActor(principal);
    const rows = await prisma.user.findMany({
      where: { AND: [accountUsers(principal.accountOwnerId), afterRow(after)] },
      select: { id: true, createTime: true, updateTime: true },
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      take: IAM_AUTHORIZATION_LIMITS.resourcesPerRequest,
    });
    return rows.map((row) => ({ ...row, userId: row.id }));
  }
  async hydrateOwners(principal: IamPrincipal, targets: readonly JsonEndpointOwnerTarget[]) {
    await this.assertActor(principal);
    if (!targets.length) return [];
    if (targets.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest) throw jsonEndpointDenied();
    return prisma.user.findMany({
      where: {
        AND: [
          accountUsers(principal.accountOwnerId),
          { OR: targets.map((t) => ({ id: t.id, updateTime: t.updateTime })) },
        ],
      },
      select: { id: true, username: true },
    });
  }
}
