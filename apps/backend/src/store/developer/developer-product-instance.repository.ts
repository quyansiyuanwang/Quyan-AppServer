import { prisma } from "@/config/database";
import type { DeveloperProductCode } from "@quyan/shared";

export class DeveloperProductInstanceRepository {
  private static instance: DeveloperProductInstanceRepository;
  static getInstance(): DeveloperProductInstanceRepository {
    return (this.instance ??= new DeveloperProductInstanceRepository());
  }

  async findActiveBackingProjectId(
    instanceId: string,
    productCode: DeveloperProductCode,
    accountOwnerId: string,
  ): Promise<string | undefined> {
    const instance = await prisma.developerProductInstance.findFirst({
      where: {
        id: instanceId,
        status: 1,
        enabled: true,
        entitlement: { status: 1, enabled: true, productCode, accountOwnerId },
      },
      select: { backingProjectId: true },
    });
    return instance?.backingProjectId;
  }
}
