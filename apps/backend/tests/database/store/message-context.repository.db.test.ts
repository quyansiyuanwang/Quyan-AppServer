import { describe, expect, it } from "vitest";
import { prisma } from "@/config/database";
import { MessageRepository } from "@/store/chat/message.repository";

describe("chat context byte budgets in MySQL", () => {
  it("counts UTF-8 bytes, excludes inactive messages, and respects replacement history", async () => {
    const user = await prisma.user.create({
      data: {
        username: "context-budget-fixture",
        password: "test-only-not-a-login",
        permissionAdds: [],
        permissionRemoves: [],
      },
    });
    const conversation = await prisma.conversation.create({
      data: { userId: user.id, title: "context budget fixture" },
    });
    const time = new Date("2026-01-01T00:00:00Z");
    try {
      await prisma.message.createMany({
        data: [
          { id: "context-a", conversationId: conversation.id, role: "user", content: "你好", createTime: time },
          { id: "context-b", conversationId: conversation.id, role: "assistant", content: "abc", createTime: time },
          {
            id: "context-c",
            conversationId: conversation.id,
            role: "user",
            content: "ignored",
            status: -1,
            createTime: time,
          },
        ],
      });
      const repository = MessageRepository.getInstance();
      expect(await repository.getContextSize(conversation.id)).toEqual({ count: 2, bytes: 9 });
      expect(await repository.getContextSize(conversation.id, { id: "context-b", createTime: time })).toEqual({
        count: 1,
        bytes: 6,
      });
      expect(await repository.findContext(conversation.id, 1)).toEqual([
        { role: "user", content: "你好" },
        { role: "assistant", content: "abc" },
      ]);
    } finally {
      await prisma.conversation.delete({ where: { id: conversation.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
