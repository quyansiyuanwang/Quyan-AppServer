import type { IamPrincipal } from "@quyan/shared";
import type { Prisma } from "@prisma/client";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { platformCarpoolOrderArn } from "@/iam/resources/platform-carpool-resources";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import { readIamPersonalCollection } from "../users/iam-personal-collection-read";
import { BadRequestError, NotFoundError } from "@/util/errors";
import { parseAllowedChannels } from "@/util/monthly-pass.util";
export interface PlatformCarpoolDeliveryChannelFilters {
  page: number;
  pageSize: number;
  keyword?: string;
  orderId?: string;
}
export interface PlatformCarpoolDeliveryChannelReadStore {
  list(
    principal: IamPrincipal,
    filters: PlatformCarpoolDeliveryChannelFilters,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
  ): Promise<{
    total: number;
    records: { id: string; name: string; channelType: string }[];
  }>;
}
export class PlatformCarpoolDeliveryChannelReadRepository implements PlatformCarpoolDeliveryChannelReadStore {
  private static instance: PlatformCarpoolDeliveryChannelReadRepository;
  static getInstance() {
    return (this.instance ??= new PlatformCarpoolDeliveryChannelReadRepository());
  }
  async list(
    principal: IamPrincipal,
    filters: PlatformCarpoolDeliveryChannelFilters,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
  ) {
    const { page, pageSize, keyword, orderId } = filters,
      limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !Number.isSafeInteger(page * pageSize) ||
      (orderId !== undefined && !isPlatformLogResourceId(orderId))
    )
      throw iamAccountDenied();
    return readIamPersonalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      let allowedChannelIds: string[] | undefined;
      if (orderId) {
        if ((await checkedDecide([platformCarpoolOrderArn(orderId)]))[0] !== "Allow") throw iamAccountDenied();
        const order = await tx.carpoolOrder.findUnique({
          where: { id: orderId },
          select: { state: true, allowedChannels: true },
        });
        if (!order)
          throw new NotFoundError("Carpool order not found", undefined, { messageKey: "carpool.orderNotFound" });
        if (order.state !== "accepted")
          throw new BadRequestError("Carpool must be accepted before selecting a delivery channel", undefined, {
            messageKey: "carpool.acceptBeforeChannel",
          });
        allowedChannelIds = parseAllowedChannels(order.allowedChannels) ?? undefined;
      }
      const where: Prisma.RelayChannelWhereInput = {
        status: 1,
        providerServiceEnabled: true,
        submissionStatus: "approved",
        ...(allowedChannelIds?.length ? { id: { in: allowedChannelIds } } : {}),
        ...(keyword ? { OR: [{ name: { contains: keyword } }, { id: { contains: keyword } }] } : {}),
      };
      let after: string | undefined;
      const targets: { id: string; name: string; updateTime: Date }[] = [];
      for (;;) {
        const rows = await tx.relayChannel.findMany({
          where: {
            ...where,
            ...(after ? { id: { ...(allowedChannelIds?.length ? { in: allowedChannelIds } : {}), gt: after } } : {}),
          },
          select: { id: true, updateTime: true },
          orderBy: { id: "asc" },
          take: limit,
        });
        if (!rows.length) break;
        const outcomes = await checkedDecide(rows.map((row) => platformRelayChannelArn(row.id)));
        for (const [index, identity] of rows.entries()) {
          if (outcomes[index] !== "Allow") continue;
          const row = await tx.relayChannel.findFirst({
            where: { ...where, id: identity.id },
            select: { id: true, name: true, updateTime: true },
          });
          if (!row || row.updateTime.getTime() !== identity.updateTime.getTime()) throw iamAccountDenied();
          targets.push(row);
        }
        after = rows[rows.length - 1]!.id;
        if (rows.length < limit) break;
      }
      targets.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      const records: { id: string; name: string; channelType: string }[] = [];
      for (const target of targets.slice((page - 1) * pageSize, page * pageSize)) {
        const row = await tx.relayChannel.findFirst({
          where: { ...where, id: target.id },
          select: { id: true, name: true, channelType: true, updateTime: true },
        });
        if (!row || row.name !== target.name || row.updateTime.getTime() !== target.updateTime.getTime())
          throw iamAccountDenied();
        records.push({ id: row.id, name: row.name, channelType: row.channelType });
      }
      return { total: targets.length, records };
    });
  }
}
