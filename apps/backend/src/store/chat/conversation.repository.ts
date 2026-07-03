import { prisma } from "@/config/database";
import type { Conversation } from "@prisma/client";
import type { ConversationListResult, ConversationStore } from "./conversation.store";
import { RECORD_STATUS } from "@/constant/status";

export class ConversationRepository implements ConversationStore {
  private static instance: ConversationRepository;

  static getInstance() {
    if (!this.instance) this.instance = new ConversationRepository();
    return this.instance;
  }

  async create(userId: string, title?: string, relayTokenId?: string): Promise<Conversation> {
    return prisma.conversation.create({
      data: { userId, title, relayTokenId },
    });
  }

  async findById(id: string): Promise<Conversation | null> {
    return prisma.conversation.findUnique({ where: { id, status: RECORD_STATUS.ACTIVE } });
  }

  async findByUserId(userId: string, page: number = 1, pageSize: number = 20): Promise<ConversationListResult> {
    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where: { userId, status: RECORD_STATUS.ACTIVE },
        orderBy: { updateTime: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.conversation.count({ where: { userId, status: RECORD_STATUS.ACTIVE } }),
    ]);
    return { conversations, total };
  }

  async update(id: string, data: { title?: string; relayTokenId?: string }): Promise<Conversation> {
    return prisma.conversation.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await prisma.conversation.update({ where: { id }, data: { status: RECORD_STATUS.DELETED } });
  }
}
