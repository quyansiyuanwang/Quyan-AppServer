import type { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import type { DeveloperPushDeliveryDto } from "@/api/dto/developer/developer.dto";
import { NotFoundError } from "@/util/errors";
import { toDeveloperPushDeliveryDto, pushDeliveryMetadataSelect } from "./developer-push-delivery.mapping";
/** A delivery must belong to the same active project as its channel; foreign keys alone do not prove that relationship. */
export class DeveloperPushDeliveryRepository {
  private static instance: DeveloperPushDeliveryRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new DeveloperPushDeliveryRepository());
  }
  private activeWhere(projectId: string, userId: string, id?: string): Prisma.DeveloperPushDeliveryWhereInput {
    return {
      id,
      projectId,
      status: 1,
      project: { userId, status: 1, user: { status: 1 } },
      channel: { projectId, status: 1, project: { userId, status: 1, user: { status: 1 } } },
    };
  }
  async listCandidates(
    projectId: string,
    userId: string,
    options: { skip: number; take: number },
  ): Promise<{ rows: DeveloperPushDeliveryDto[]; eligibility: boolean[] }> {
    const records = await prisma.developerPushDelivery.findMany({
      where: this.activeWhere(projectId, userId),
      select: pushDeliveryMetadataSelect,
      orderBy: [{ createTime: "desc" }, { id: "asc" }],
      ...options,
    });
    const channels = records.length
      ? await prisma.developerPushChannel.findMany({
          where: {
            id: { in: records.map((row) => row.channelId) },
            projectId,
            status: 1,
            project: { userId, status: 1, user: { status: 1 } },
          },
          select: { id: true, projectId: true },
        })
      : [];
    const canonicalChannels = new Set(channels.filter((row) => row.projectId === projectId).map((row) => row.id));
    // Preserve raw candidate count and offset positions even if old foreign keys are noncanonical.
    return {
      rows: records.map(toDeveloperPushDeliveryDto),
      eligibility: records.map((row) => row.projectId === projectId && canonicalChannels.has(row.channelId)),
    };
  }
  async get(projectId: string, userId: string, id: string): Promise<DeveloperPushDeliveryDto> {
    const record = await prisma.developerPushDelivery.findFirst({
      where: this.activeWhere(projectId, userId, id),
      select: pushDeliveryMetadataSelect,
    });
    const channel = record
      ? await prisma.developerPushChannel.findFirst({
          where: { id: record.channelId, projectId, status: 1, project: { userId, status: 1, user: { status: 1 } } },
          select: { id: true, projectId: true },
        })
      : undefined;
    if (
      !record ||
      record.id !== id ||
      record.projectId !== projectId ||
      !channel ||
      channel.id !== record.channelId ||
      channel.projectId !== projectId
    )
      throw new NotFoundError("Push delivery metadata is unavailable", undefined, {
        messageKey: "developerProject.pushRecordNotFound",
      });
    return toDeveloperPushDeliveryDto(record);
  }
}
