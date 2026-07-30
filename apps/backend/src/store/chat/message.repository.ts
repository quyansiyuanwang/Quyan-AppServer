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
    return prisma.$transaction(async (tx) => {
      const message = await tx.message.create({ data });
      await tx.conversation.update({ where: { id: data.conversationId }, data: {} });
      return message;
    });
  }

  async findByConversationId(conversationId: string): Promise<Message[]> {
    return prisma.message.findMany({
      where: { conversationId, status: RECORD_STATUS.ACTIVE },
      orderBy: [{ createTime: "asc" }, { id: "asc" }],
    });
  }

  async findById(id: string): Promise<Message | null> {
    return prisma.message.findUnique({ where: { id } });
  }

  async update(
    id: string,
    data: Partial<Pick<MessageCreateInput, "content" | "completionStatus">>,
  ): Promise<Message> {
    return prisma.$transaction(async (tx) => {
      const message = await tx.message.update({ where: { id }, data });
      await tx.conversation.update({ where: { id: message.conversationId }, data: {} });
      return message;
    });
  }

  async replaceFrom(messageId: string, content: string): Promise<Message> {
    return prisma.$transaction(async (tx) => {
      const message = await tx.message.findUnique({ where: { id: messageId } });
      if (!message) throw new Error("Message not found");

      const messages = await tx.message.findMany({
        where: { conversationId: message.conversationId, status: RECORD_STATUS.ACTIVE },
        orderBy: [{ createTime: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      const index = messages.findIndex((item) => item.id === messageId);
      if (index < 0) throw new Error("Message not found");

      const followingIds = messages.slice(index + 1).map((item) => item.id);
      if (followingIds.length)
        await tx.message.updateMany({ where: { id: { in: followingIds } }, data: { status: RECORD_STATUS.DELETED } });

      const updated = await tx.message.update({ where: { id: messageId }, data: { content } });
      await tx.conversation.update({ where: { id: message.conversationId }, data: {} });
      return updated;
    });
  }

  async delete(id: string): Promise<void> {
    await this.deleteFrom(id);
  }

  async deleteFrom(messageId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const message = await tx.message.findUnique({ where: { id: messageId } });
      if (!message) return;

      const messages = await tx.message.findMany({
        where: { conversationId: message.conversationId, status: RECORD_STATUS.ACTIVE },
        orderBy: [{ createTime: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      const index = messages.findIndex((item) => item.id === messageId);
      if (index < 0) return;

      await tx.message.updateMany({
        where: { id: { in: messages.slice(index).map((item) => item.id) } },
        data: { status: RECORD_STATUS.DELETED },
      });
      await tx.conversation.update({ where: { id: message.conversationId }, data: {} });
    });
  }
}
