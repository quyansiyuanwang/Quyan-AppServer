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
    const [, id, childId, nestedId] = resourceArn.split(":")[4].split("/");
    const active = { status: AccountStatus.ACTIVE };
    const userOwner = { OR: [{ accountOwnerId }, { id: accountOwnerId, accountOwnerId: null }] };
    switch (type.id) {
      case "balance/transaction": {
        const owner = await prisma.user.findFirst({ where: { id, ...active, ...userOwner }, select: { id: true } });
        if (!owner) return false;
        const row = await prisma.balanceTransaction.findFirst({
          where: { id: childId, userId: owner.id, ...active },
          select: { id: true, userId: true },
        });
        return row?.id === childId && row.userId === id;
      }
      case "quyan/online-session": {
        const session = await prisma.userOnlineSession.findFirst({
          where: { id: childId, userId: id, ...active, user: { ...active, ...userOwner } },
          select: { id: true, userId: true },
        });
        return session?.id === childId && session.userId === id;
      }
      case "oj/api-key": {
        // OJAPIKey deliberately has no Prisma User relation.
        const owner = await prisma.user.findFirst({ where: { id, ...active, ...userOwner }, select: { id: true } });
        if (!owner) return false;
        const key = await prisma.oJAPIKey.findFirst({
          where: { id: childId, userId: owner.id, ...active },
          select: { id: true, userId: true },
        });
        return key?.id === childId && key.userId === id;
      }
      case "json-endpoint/endpoint": {
        const endpoint = await prisma.jsonEndpoint.findFirst({
          where: { id: childId, userId: id, ...active, user: { ...active, ...userOwner } },
          select: { id: true, userId: true },
        });
        return endpoint?.id === childId && endpoint.userId === id;
      }
      case "quyan/passkey": {
        const passkey = await prisma.passkeyCredential.findFirst({
          where: { id: childId, userId: id, user: { ...active, ...userOwner } },
          select: { id: true, userId: true },
        });
        return passkey?.id === childId && passkey.userId === id;
      }
      case "script/execution": {
        const execution = await prisma.userScriptExecution.findFirst({
          where: {
            id: childId,
            userId: id,
            user: { ...active, ...userOwner },
            OR: [{ scriptId: null }, { script: { userId: id } }],
          },
          select: { id: true, userId: true },
        });
        return execution?.id === childId && execution.userId === id;
      }
      case "agent/approval": {
        const approval = await prisma.agentApproval.findFirst({
          where: {
            id: nestedId,
            taskId: childId,
            status: "pending",
            expiresAt: { gt: new Date() },
            step: { taskId: childId },
            task: {
              id: childId,
              userId: id,
              ...active,
              taskStatus: "waiting_approval",
              user: { ...active, ...userOwner },
              workspace: { userId: id, ...active },
              conversation: { userId: id, ...active },
            },
          },
          select: { id: true, taskId: true },
        });
        return approval?.id === nestedId && approval.taskId === childId;
      }
      case "agent/task": {
        const task = await prisma.agentTask.findFirst({
          where: {
            id: childId,
            userId: id,
            ...active,
            user: { ...active, ...userOwner },
            workspace: { userId: id, ...active },
            conversation: { userId: id, ...active },
          },
          select: { id: true, userId: true },
        });
        return task?.id === childId && task.userId === id;
      }
      case "agent/workspace": {
        const workspace = await prisma.agentWorkspace.findFirst({
          where: { id: childId, userId: id, ...active, user: { ...active, ...userOwner } },
          select: { id: true, userId: true },
        });
        return workspace?.id === childId && workspace.userId === id;
      }
      case "agent/machine": {
        const machine = await prisma.agentRuntimeMachine.findFirst({
          where: { id: childId, userId: id, ...active, user: { ...active, ...userOwner } },
          select: { id: true, userId: true },
        });
        return machine?.id === childId && machine.userId === id;
      }
      case "mcp/server": {
        const server = await prisma.mcpServer.findFirst({
          where: { id: childId, userId: id, ...active, user: { ...active, ...userOwner } },
          select: { id: true, userId: true },
        });
        return server?.id === childId && server.userId === id;
      }
      case "ticket/ticket": {
        const ticket = await prisma.ticket.findFirst({
          where: { id: childId, userId: id, ...active, user: { ...active, ...userOwner } },
          select: { id: true, userId: true },
        });
        return ticket?.id === childId && ticket.userId === id;
      }
      case "script/script": {
        const script = await prisma.userScript.findFirst({
          where: { id: childId, userId: id, ...active, user: { ...active, ...userOwner } },
          select: { id: true, userId: true },
        });
        return script?.id === childId && script.userId === id;
      }
      case "quyan/account":
        return Boolean(await prisma.user.findFirst({ where: { id: accountOwnerId, ...active } }));
      case "quyan/user":
        return Boolean(await prisma.user.findFirst({ where: { id, ...active, ...userOwner } }));
      case "quyan/access-key":
        return Boolean(
          await prisma.accessKey.findFirst({
            where: { id: childId, userId: id, ...active, user: { ...active, ...userOwner } },
            select: { id: true },
          }),
        );
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
      case "notification/webhook": {
        const webhook = await prisma.notificationWebhook.findUnique({
          where: { id: childId },
          select: {
            id: true,
            userId: true,
            status: true,
            preferenceId: true,
            preference: { select: { id: true, userId: true, status: true } },
          },
        });
        if (
          !webhook ||
          webhook.id !== childId ||
          webhook.userId !== id ||
          webhook.status !== AccountStatus.ACTIVE ||
          webhook.preferenceId !== webhook.preference.id ||
          webhook.preference.userId !== id ||
          webhook.preference.status !== AccountStatus.ACTIVE
        )
          return false;
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
      case "balance/gift-code": {
        const record = await prisma.balanceGiftCode.findFirst({
          where: { id: childId, createdBy: id, ...active, createdByUser: { ...active, ...userOwner } },
          select: { id: true, createdBy: true },
        });
        return record?.id === childId && record.createdBy === id;
      }
      case "chat/conversation": {
        const record = await prisma.conversation.findFirst({
          where: { id, ...active, user: { ...active, ...userOwner } },
          select: { id: true },
        });
        return record?.id === id;
      }
      case "chat/message": {
        const record = await prisma.message.findFirst({
          where: { id, ...active, conversation: { ...active, user: { ...active, ...userOwner } } },
          select: { id: true },
        });
        return record?.id === id;
      }
      case "carpool/order": {
        const record = await prisma.carpoolOrder.findFirst({
          where: {
            id,
            ...active,
            members: { some: { ...active, state: { not: "left" }, user: { ...active, ...userOwner } } },
          },
          select: { id: true },
        });
        return record?.id === id;
      }
      case "carpool/template": {
        // Published templates are shared offerings; the ARN scopes use to this account, never template ownership.
        const record = await prisma.carpoolPackageTemplate.findFirst({
          where: { id, ...active, publishStatus: "published", monthlyPassTemplate: active },
          select: { id: true },
        });
        return record?.id === id;
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
      case "relay/token": {
        const token = await prisma.relayToken.findFirst({
          where: {
            id: childId,
            userId: id,
            ...active,
            user: { ...active, ...userOwner },
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          select: { id: true, userId: true },
        });
        return token?.id === childId && token.userId === id;
      }
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
