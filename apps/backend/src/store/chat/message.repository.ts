import { prisma } from "@/config/database";
import type { Message } from "@prisma/client";
import type { MessageCreateInput, MessageStore } from "./message.store";
import { RECORD_STATUS } from "@/constant/status";

export class MessageRepository implements MessageStore {
  private static instance: MessageRepository;

  static getInstance() {
    if (!this.instance) this.instance = new MessageRepository();
    return this.instance;
  }

  async create(data: MessageCreateInput): Promise<Message> {
    return prisma.message.create({ data });
  }

  async findByConversationId(conversationId: string): Promise<Message[]> {
    return prisma.message.findMany({
      where: { conversationId, status: RECORD_STATUS.ACTIVE },
      orderBy: { createTime: "asc" },
    });
  }

  async findById(id: string): Promise<Message | null> {
    return prisma.message.findUnique({ where: { id } });
  }

  async delete(id: string): Promise<void> {
    await prisma.message.update({ where: { id }, data: { status: RECORD_STATUS.DELETED } });
  }
}
