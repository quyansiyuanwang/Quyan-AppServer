import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { ojApiKeyDenied as denied } from "./oj-apikey-management.repository";
import { ConflictError } from "@/util/errors";
import type {
  OjApiKeyUpdateInput,
  OjApiKeyUpdateGuard,
  OjApiKeyMutationStore,
  OjApiKeyCreateInput,
  OjApiKeyCreateGuard,
} from "./oj-apikey-mutation.store";
const metadata = {
  id: true,
  userId: true,
  name: true,
  requestCount: true,
  totalTokens: true,
  expiresAt: true,
  lastUsedAt: true,
  createTime: true,
  channelId: true,
  channel: { select: { name: true } },
} as const;
export class OjApiKeyMutationRepository implements OjApiKeyMutationStore {
  private static instance: OjApiKeyMutationRepository;
  static getInstance() {
    return (this.instance ??= new OjApiKeyMutationRepository());
  }
  /** Issuance returns only the new credential, never another stored key or full channel configuration. */
  async create(data: OjApiKeyCreateInput, guard: OjApiKeyCreateGuard) {
    return prisma.$transaction(
      async (tx) => {
        if (data.userId !== guard.identity.principal.subjectUserId || data.userId !== guard.identity.targetUserId)
          throw denied();
        await assertIamAccountUserMutation(tx, guard.identity, data.userId);
        await this.assertChannelSnapshot(tx, data.channelId, guard.channel);
        const record = await tx.oJAPIKey.create({ data, select: { ...metadata, key: true } });
        await assertIamAccountUserMutation(tx, guard.identity, data.userId);
        return record;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  private async assertChannelSnapshot(
    tx: Prisma.TransactionClient,
    id: string | null | undefined,
    channel: OjApiKeyCreateGuard["channel"],
  ) {
    if (!id) return;
    if (!channel || channel.id !== id) throw denied();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM relay_channels WHERE id = ${channel.id} FOR UPDATE`);
    const current = await tx.relayChannel.findFirst({
      where: { id: channel.id, status: channel.status, updateTime: channel.updateTime },
      select: { id: true },
    });
    if (!current) throw denied();
  }
  async update(data: OjApiKeyUpdateInput, guard: OjApiKeyUpdateGuard) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const { target, identity, channel } = guard;
          if (
            target.userId !== identity.principal.subjectUserId ||
            target.userId !== identity.targetUserId ||
            target.status !== 1
          )
            throw denied();
          await assertIamAccountUserMutation(tx, identity, target.userId);
          await this.assertChannelSnapshot(tx, data.channelId, channel);
          const where = { id: target.id, userId: target.userId, status: 1, updateTime: target.updateTime };
          if ((await tx.oJAPIKey.updateMany({ where, data })).count !== 1) throw denied();
          await assertIamAccountUserMutation(tx, identity, target.userId);
          const reveal = await guard.canReveal(),
            record = await tx.oJAPIKey.findFirst({
              where: { id: target.id, userId: target.userId, status: 1 },
              select: { ...metadata, ...(reveal ? { key: true } : {}) },
            });
          if (!record) throw denied();
          const { key, ...view } = record;
          return { ...view, ...(reveal && typeof key === "string" ? { key } : {}) };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034")
        throw new ConflictError("OJ API Key changed after authorization", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
}
