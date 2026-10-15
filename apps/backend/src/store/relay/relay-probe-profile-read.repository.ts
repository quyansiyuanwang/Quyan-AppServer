import type { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { platformRelayChannelArn } from "@/iam/resources/platform-relay-channel-resources";
import { platformRelayProbeProfileArn } from "@/iam/resources/platform-relay-probe-resources";
import { NotFoundError } from "@/util/errors";
import { readIamPersonalCollection } from "../users/iam-personal-collection-read";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { ProbeChannelVisibilityRecord } from "./relay-probe-latest-run-read.repository";
import { relayProbeReadTarget } from "./relay-probe-read-target";
/** Workflow and encrypted credential names are loaded only after the profile resource is admitted. */
const profileSelect = {
  id: true,
  relayChannelId: true,
  enabled: true,
  probeFormat: true,
  probeEndpoint: true,
  probeModel: true,
  probePayload: true,
  preventCache: true,
  cacheMode: true,
  sampleCount: true,
  strictCalibrationValidation: true,
  measurementInputTokens: true,
  balanceSettlementTolerance: true,
  balanceSettlementReads: true,
  upstreamCurrency: true,
  localCurrency: true,
  upstreamBalanceDivisor: true,
  upstreamRateMultiplier: true,
  probeGroup: true,
  distributionMultiplier: true,
  workflow: true,
  encryptedCredentials: true,
  credentialIv: true,
  credentialAuthTag: true,
  createTime: true,
  updateTime: true,
} as const satisfies Prisma.RelayChannelProbeProfileSelect;
export type RelayProbeProfileReadRecord = Prisma.RelayChannelProbeProfileGetPayload<{ select: typeof profileSelect }>;
export class RelayProbeProfileReadRepository {
  private static instance: RelayProbeProfileReadRepository;
  static getInstance() {
    return (this.instance ??= new RelayProbeProfileReadRepository());
  }
  async get<T>(
    principal: IamPrincipal,
    channelId: string,
    decide: (resources: readonly string[]) => Promise<readonly string[]>,
    recheck: () => Promise<void>,
    visible: (channel: ProbeChannelVisibilityRecord) => Promise<boolean>,
    map: (profile: RelayProbeProfileReadRecord, permittedMembers: ReadonlySet<string> | undefined) => T,
  ) {
    return readIamPersonalCollection(principal, decide, recheck, async (tx, checkedDecide) => {
      if ((await checkedDecide([platformRelayChannelArn(channelId)]))[0] !== "Allow") throw iamAccountDenied();
      const { channel, members } = await relayProbeReadTarget(tx, channelId, undefined, visible),
        metadata = await tx.relayChannelProbeProfile.findUnique({
          where: { relayChannelId: channelId },
          select: { id: true, updateTime: true },
        });
      if (!metadata)
        throw new NotFoundError("Probe profile not found", undefined, {
          messageKey: "relayChannelProbe.profileNotFound",
        });
      if ((await checkedDecide([platformRelayProbeProfileArn(channelId, metadata.id)]))[0] !== "Allow")
        throw iamAccountDenied();
      const permittedMembers = channel.channelType === "pooled" ? new Set<string>() : undefined,
        identifiers = [...members],
        limit = IAM_AUTHORIZATION_LIMITS.resourcesPerRequest;
      for (let offset = 0; offset < identifiers.length; offset += limit) {
        const batch = identifiers.slice(offset, offset + limit),
          outcomes = await checkedDecide(batch.map(platformRelayChannelArn));
        batch.forEach((id, index) => {
          if (outcomes[index] === "Allow") permittedMembers?.add(id);
        });
      }
      const record = await tx.relayChannelProbeProfile.findUnique({
        where: { id: metadata.id },
        select: profileSelect,
      });
      if (
        !record ||
        record.relayChannelId !== channelId ||
        record.updateTime.getTime() !== metadata.updateTime.getTime()
      )
        throw iamAccountDenied();
      return map(record, permittedMembers);
    });
  }
}
