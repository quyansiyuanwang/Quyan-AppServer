import { ArticleManagementRepository } from "@/store/content/article-management.repository";
import { developerKvKeyFromArnSegment } from "@/iam/resources/developer-resources";
import { developerSecretAliasSchema } from "@/api/schema/developer/developer.schema";
import { lockRamResourceGroup } from "./ram-resource-group-lock";
import type { IamManagementPage } from "@/iam/management-pagination";
import { iamManagementPaginationSchema } from "@/iam/management-pagination";
import { getIamResourceType } from "@quyan/shared";
import { prisma } from "@/config/database";
import { AccountStatus } from "@/util/auth/account-status";
import type {
  RamResourceGroupStore,
  CreateRamResourceGroupInput,
  CreateRamResourceGroupMemberInput,
} from "./ram-resource-group.store";
export class RamResourceGroupRepository implements RamResourceGroupStore {
  private static instance: RamResourceGroupRepository;
  static getInstance() {
    return (this.instance ??= new RamResourceGroupRepository());
  }
  list(accountOwnerId: string, page: IamManagementPage = iamManagementPaginationSchema.parse({})) {
    return prisma.ramResourceGroup.findMany({
      where: { accountOwnerId, status: AccountStatus.ACTIVE },
      include: { members: { where: { status: AccountStatus.ACTIVE }, orderBy: { createTime: "asc" } } },
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    });
  }
  async listSummaryPage(accountOwnerId: string, page: IamManagementPage) {
    const records = await prisma.ramResourceGroup.findMany({
      where: { accountOwnerId, status: AccountStatus.ACTIVE },
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize + 1,
    });
    return { items: records.slice(0, page.pageSize), ...page, hasNext: records.length > page.pageSize };
  }
  async listMemberPage(accountOwnerId: string, groupId: string, page: IamManagementPage) {
    const records = await prisma.ramResourceGroupMember.findMany({
      where: {
        accountOwnerId,
        resourceGroupId: groupId,
        status: AccountStatus.ACTIVE,
        resourceGroup: { accountOwnerId, status: AccountStatus.ACTIVE },
      },
      orderBy: [{ createTime: "desc" }, { id: "desc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize + 1,
    });
    return { items: records.slice(0, page.pageSize), ...page, hasNext: records.length > page.pageSize };
  }
  findSummaryById(id: string) {
    return prisma.ramResourceGroup.findFirst({ where: { id, status: AccountStatus.ACTIVE } });
  }
  create(data: CreateRamResourceGroupInput) {
    return prisma.ramResourceGroup.create({
      data: { ...data, status: AccountStatus.ACTIVE, description: data.description ?? null },
    });
  }
  findById(id: string) {
    return prisma.ramResourceGroup.findFirst({
      where: { id, status: AccountStatus.ACTIVE },
      include: { members: { where: { status: AccountStatus.ACTIVE } } },
    });
  }
  async resourceExistsInAccount(resourceArn: string, accountOwnerId: string): Promise<boolean> {
    const type = getIamResourceType(resourceArn);
    if (!type || resourceArn.split(":")[3] !== accountOwnerId) return false;
    const [, id, childId] = resourceArn.split(":")[4].split("/");
    const active = { status: AccountStatus.ACTIVE };
    const userOwner = { OR: [{ accountOwnerId }, { id: accountOwnerId, accountOwnerId: null }] };
    switch (type.id) {
      case "quyan/account":
        return Boolean(await prisma.user.findFirst({ where: { id: accountOwnerId, ...active } }));
      case "quyan/user":
        return Boolean(await prisma.user.findFirst({ where: { id, ...active, ...userOwner } }));
      case "quyan/group":
        return Boolean(await prisma.group.findFirst({ where: { id, accountOwnerId, ...active } }));
      case "quyan/role":
        return Boolean(await prisma.ramRole.findFirst({ where: { id, accountOwnerId, ...active } }));
      case "quyan/policy":
        return Boolean(await prisma.ramPolicy.findFirst({ where: { id, accountOwnerId, ...active } }));
      case "quyan/policy-version":
        return Boolean(
          await prisma.ramPolicyVersion.findFirst({
            where: { id: childId, policyId: id, ...active, policy: { accountOwnerId, ...active } },
          }),
        );
      case "quyan/authorization":
        return Boolean(await prisma.ramAuthorization.findFirst({ where: { id, accountOwnerId, ...active } }));
      case "quyan/resource-group":
        return Boolean(await prisma.ramResourceGroup.findFirst({ where: { id, accountOwnerId, ...active } }));
      case "quyan/role-session":
        return Boolean(
          await prisma.ramRoleSession.findFirst({
            where: { id, accountOwnerId, ...active, revokedAt: null, expiresAt: { gt: new Date() } },
          }),
        );
      case "notification/delivery-log": {
        const log = await prisma.notificationLog.findUnique({
          where: { id: childId },
          select: { id: true, userId: true },
        });
        if (!log || log.id !== childId || log.userId !== id) return false;
        const user = await prisma.user.findUnique({
          where: { id },
          select: { id: true, status: true, accountOwnerId: true },
        });
        return Boolean(
          user &&
            user.id === id &&
            user.status === AccountStatus.ACTIVE &&
            (user.accountOwnerId || user.id) === accountOwnerId,
        );
      }
      case "notification/inbox-item": {
        const item = await prisma.notificationInboxItem.findFirst({
          where: { id: childId, userId: id, ...active, user: { ...active, ...userOwner } },
          select: { id: true, userId: true, user: { select: { id: true, accountOwnerId: true } } },
        });
        return Boolean(
          item &&
            item.id === childId &&
            item.userId === id &&
            item.user.id === id &&
            (item.user.accountOwnerId || item.user.id) === accountOwnerId,
        );
      }
      case "article/article":
        return Boolean(await ArticleManagementRepository.getInstance().findTarget(id, accountOwnerId));
      case "developer/project": {
        const project = await prisma.developerProject.findFirst({
          where: { id, ...active, user: { ...active, ...userOwner } },
          select: { id: true },
        });
        return project?.id === id;
      }
      case "developer/push-delivery": {
        const record = await prisma.developerPushDelivery.findFirst({
          where: {
            id: childId,
            projectId: id,
            ...active,
            project: { ...active, user: { ...active, ...userOwner } },
            channel: { projectId: id, ...active, project: { ...active, user: { ...active, ...userOwner } } },
          },
          select: { id: true, projectId: true, channelId: true },
        });
        if (!record || record.id !== childId || record.projectId !== id) return false;
        const channel = await prisma.developerPushChannel.findFirst({
          where: {
            id: record.channelId,
            projectId: id,
            ...active,
            project: { ...active, user: { ...active, ...userOwner } },
          },
          select: { id: true, projectId: true },
        });
        return channel?.id === record.channelId && channel.projectId === id;
      }
      case "developer/push-channel": {
        const record = await prisma.developerPushChannel.findFirst({
          where: { id: childId, projectId: id, ...active, project: { ...active, user: { ...active, ...userOwner } } },
          select: { id: true, projectId: true },
        });
        return record?.id === childId && record.projectId === id;
      }
      case "developer/status-monitor": {
        const record = await prisma.developerStatusMonitor.findFirst({
          where: { id: childId, projectId: id, ...active, project: { ...active, user: { ...active, ...userOwner } } },
          select: { id: true, projectId: true },
        });
        return record?.id === childId && record.projectId === id;
      }
      case "developer/project-api-key": {
        const record = await prisma.developerProjectApiKey.findFirst({
          where: { id: childId, projectId: id, ...active, project: { ...active, user: { ...active, ...userOwner } } },
          select: { id: true, projectId: true },
        });
        return record?.id === childId && record.projectId === id;
      }
      case "developer/short-link": {
        const record = await prisma.developerShortLink.findFirst({
          where: { id: childId, projectId: id, ...active, project: { ...active, user: { ...active, ...userOwner } } },
          select: { id: true, projectId: true },
        });
        return record?.id === childId && record.projectId === id;
      }
      case "developer/kv-item": {
        const key = developerKvKeyFromArnSegment(childId);
        if (!key) return false;
        const record = await prisma.developerKvEntry.findFirst({
          where: {
            projectId: id,
            key,
            ...active,
            project: { ...active, user: { ...active, ...userOwner } },
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          select: { key: true, projectId: true },
        });
        return record?.key === key && record.projectId === id;
      }
      case "developer/secret": {
        const alias = developerSecretAliasSchema.safeParse(childId);
        if (!alias.success || alias.data !== childId) return false;
        const record = await prisma.developerSecret.findFirst({
          where: {
            projectId: id,
            alias: childId,
            ...active,
            project: { ...active, user: { ...active, ...userOwner } },
          },
          select: { alias: true, projectId: true },
        });
        return record?.alias === childId && record.projectId === id;
      }
      // Shared/global channels have no account ownership. Only submission-owned channels may join a group.
      case "relay/channel":
        return Boolean(await prisma.relayChannel.findFirst({ where: { id, ...active, submittedBy: userOwner } }));
      default:
        return false;
    }
  }
  addMember(data: CreateRamResourceGroupMemberInput) {
    return prisma.$transaction(
      async (tx) => {
        const { expectedGroupUpdateTime, ...record } = data;
        await lockRamResourceGroup(tx, data.resourceGroupId, expectedGroupUpdateTime);
        return tx.ramResourceGroupMember.upsert({
          where: {
            resourceGroupId_resourceArn: { resourceGroupId: data.resourceGroupId, resourceArn: data.resourceArn },
          },
          create: { ...record, status: AccountStatus.ACTIVE },
          update: { status: AccountStatus.ACTIVE },
        });
      },
      { isolationLevel: "Serializable" },
    );
  }
  async removeMember(groupId: string, memberId: string, expectedGroupUpdateTime?: Date) {
    await prisma.$transaction(
      async (tx) => {
        await lockRamResourceGroup(tx, groupId, expectedGroupUpdateTime);
        await tx.ramResourceGroupMember.updateMany({
          where: { id: memberId, resourceGroupId: groupId, status: AccountStatus.ACTIVE },
          data: { status: AccountStatus.DELETED },
        });
      },
      { isolationLevel: "Serializable" },
    );
  }
}
