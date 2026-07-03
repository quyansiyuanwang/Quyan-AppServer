import { prisma, type LegalPolicyVersion, type UserPolicyAcceptance } from "@/config/database";
import { MANAGED_STATUS } from "@/constant/status";
import { LegalPolicyPublishStatus, type LegalPolicyType } from "@/constant/legal-policy";
import type {
  LegalPolicyCreateInput,
  LegalPolicyQueryFilters,
  LegalPolicyStore,
  LegalPolicyUpdateInput,
  UserPolicyAcceptanceCreateInput,
} from "./legal-policy.store";

export class LegalPolicyRepository implements LegalPolicyStore {
  private static instance: LegalPolicyRepository;

  public static getInstance(): LegalPolicyRepository {
    if (!LegalPolicyRepository.instance) LegalPolicyRepository.instance = new LegalPolicyRepository();

    return LegalPolicyRepository.instance;
  }

  async create(data: LegalPolicyCreateInput): Promise<LegalPolicyVersion> {
    return prisma.legalPolicyVersion.create({
      data,
    });
  }

  async update(id: string, data: LegalPolicyUpdateInput): Promise<LegalPolicyVersion> {
    return prisma.legalPolicyVersion.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<LegalPolicyVersion> {
    return prisma.legalPolicyVersion.update({
      where: { id },
      data: { status: MANAGED_STATUS.DELETED },
    });
  }

  async findById(id: string): Promise<LegalPolicyVersion | null> {
    return prisma.legalPolicyVersion.findFirst({
      where: {
        id,
        status: MANAGED_STATUS.ENABLED,
      },
    });
  }

  async findAll(filters?: LegalPolicyQueryFilters): Promise<LegalPolicyVersion[]> {
    return prisma.legalPolicyVersion.findMany({
      where: {
        status: MANAGED_STATUS.ENABLED,
        ...(filters?.policyType ? { policyType: filters.policyType } : {}),
        ...(filters?.publishStatus ? { publishStatus: filters.publishStatus } : {}),
        ...(filters?.isCurrent !== undefined ? { isCurrent: filters.isCurrent } : {}),
      },
      orderBy: [{ policyType: "asc" }, { version: "desc" }, { createTime: "desc" }],
    });
  }

  async findLatestVersionByPolicyType(policyType: LegalPolicyType): Promise<LegalPolicyVersion | null> {
    return prisma.legalPolicyVersion.findFirst({
      where: {
        policyType,
      },
      orderBy: [{ version: "desc" }, { createTime: "desc" }],
    });
  }

  async findDraftByPolicyType(policyType: LegalPolicyType): Promise<LegalPolicyVersion | null> {
    return prisma.legalPolicyVersion.findFirst({
      where: {
        policyType,
        publishStatus: LegalPolicyPublishStatus.DRAFT,
        status: MANAGED_STATUS.ENABLED,
      },
      orderBy: [{ version: "desc" }],
    });
  }

  async findCurrentPublishedByPolicyType(policyType: LegalPolicyType): Promise<LegalPolicyVersion | null> {
    return prisma.legalPolicyVersion.findFirst({
      where: {
        policyType,
        publishStatus: LegalPolicyPublishStatus.PUBLISHED,
        isCurrent: true,
        status: MANAGED_STATUS.ENABLED,
      },
    });
  }

  async findCurrentPublishedByPolicyTypes(policyTypes: LegalPolicyType[]): Promise<LegalPolicyVersion[]> {
    if (policyTypes.length === 0) return [];

    return prisma.legalPolicyVersion.findMany({
      where: {
        policyType: { in: policyTypes },
        publishStatus: LegalPolicyPublishStatus.PUBLISHED,
        isCurrent: true,
        status: MANAGED_STATUS.ENABLED,
      },
      orderBy: [{ policyType: "asc" }],
    });
  }

  async findLatestPublishedVersionByPolicyType(
    policyType: LegalPolicyType,
    excludeId?: string,
  ): Promise<LegalPolicyVersion | null> {
    return prisma.legalPolicyVersion.findFirst({
      where: {
        policyType,
        publishStatus: LegalPolicyPublishStatus.PUBLISHED,
        status: MANAGED_STATUS.ENABLED,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      orderBy: [{ version: "desc" }, { publishedAt: "desc" }],
    });
  }

  async publishVersion(id: string, policyType: LegalPolicyType): Promise<LegalPolicyVersion> {
    const [, published] = await prisma.$transaction([
      prisma.legalPolicyVersion.updateMany({
        where: {
          policyType,
          status: MANAGED_STATUS.ENABLED,
          isCurrent: true,
        },
        data: {
          isCurrent: false,
        },
      }),
      prisma.legalPolicyVersion.update({
        where: { id },
        data: {
          publishStatus: LegalPolicyPublishStatus.PUBLISHED,
          isCurrent: true,
          publishedAt: new Date(),
        },
      }),
    ]);

    return published;
  }

  async unpublishVersion(
    id: string,
    policyType: LegalPolicyType,
    fallbackCurrentId?: string,
  ): Promise<LegalPolicyVersion> {
    const operations = [
      prisma.legalPolicyVersion.update({
        where: { id },
        data: {
          publishStatus: LegalPolicyPublishStatus.DRAFT,
          isCurrent: false,
          publishedAt: null,
        },
      }),
    ];

    if (fallbackCurrentId) {
      operations.push(
        prisma.legalPolicyVersion.updateMany({
          where: {
            policyType,
            status: MANAGED_STATUS.ENABLED,
            isCurrent: true,
            id: { not: fallbackCurrentId },
          },
          data: {
            isCurrent: false,
          },
        }) as never,
      );
      operations.push(
        prisma.legalPolicyVersion.update({
          where: { id: fallbackCurrentId },
          data: {
            isCurrent: true,
          },
        }) as never,
      );
    }

    const result = await prisma.$transaction(operations);
    return result[0] as LegalPolicyVersion;
  }

  async createAcceptance(data: UserPolicyAcceptanceCreateInput): Promise<UserPolicyAcceptance> {
    return prisma.userPolicyAcceptance.create({
      data: {
        ...data,
        source: data.source ?? "auth",
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
        acceptedAt: data.acceptedAt ?? new Date(),
      },
    });
  }

  async findAcceptedPolicyVersionIds(userId: string, policyVersionIds: string[]): Promise<string[]> {
    if (policyVersionIds.length === 0) return [];

    const rows = await prisma.userPolicyAcceptance.findMany({
      where: {
        userId,
        policyVersionId: {
          in: policyVersionIds,
        },
        status: MANAGED_STATUS.ENABLED,
      },
      select: {
        policyVersionId: true,
      },
    });

    return rows.map((row) => row.policyVersionId);
  }

  async findLatestAcceptanceByUserAndType(
    userId: string,
    policyType: LegalPolicyType,
  ): Promise<UserPolicyAcceptance | null> {
    return prisma.userPolicyAcceptance.findFirst({
      where: {
        userId,
        policyType,
        status: MANAGED_STATUS.ENABLED,
      },
      orderBy: [{ acceptedAt: "desc" }, { createTime: "desc" }],
    });
  }
}
