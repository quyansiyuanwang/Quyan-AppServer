import { performance } from "node:perf_hooks";
import { buildAcsResource, type IamPrincipal } from "@quyan/shared";
import { env } from "@/config/env";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { auditIamDecision } from "@/iam/audit/iam-audit.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { requestConditionContext } from "@/iam/request/condition-context";
import { ojApiKeyArn, isCanonicalOjApiKeyId } from "@/iam/resources/oj-apikey-resources";
import { IamAccountUserRepository } from "@/store/users/iam-account-principal";
import {
  OjApiKeyManagementRepository,
  ojApiKeyDenied as denied,
} from "@/store/oj-submitter/oj-apikey-management.repository";
import { OjApiKeyMutationRepository } from "@/store/oj-submitter/oj-apikey-mutation.repository";
import type {
  OjApiKeyUpdateInput,
  OjApiKeyMutationStore,
  OjApiKeyCreateGuard,
} from "@/store/oj-submitter/oj-apikey-mutation.store";
import { RelayChannelService } from "@/services/relay/relay-channel.service";
import { BadRequestError } from "@/util/errors";
import type { TypedRequest } from "@/types/express";
export class OjApiKeyMutationIamService {
  private static instance: OjApiKeyMutationIamService;
  private constructor(
    private readonly iam = IamAuthorizationService.getInstance(),
    private readonly keys: Pick<OjApiKeyManagementRepository, "target"> = OjApiKeyManagementRepository.getInstance(),
    private readonly users: Pick<IamAccountUserRepository, "targets"> = IamAccountUserRepository.getInstance(),
    private readonly channels: Pick<
      RelayChannelService,
      "assertChannelBusinessSelectableMetadataById"
    > = RelayChannelService.getInstance(),
    private readonly mutations: OjApiKeyMutationStore = OjApiKeyMutationRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new OjApiKeyMutationIamService());
  }
  private async decision(principal: IamPrincipal, request: TypedRequest, action: string, resource: string) {
    const start = performance.now(),
      result = await this.iam.authorize({
        principal,
        action,
        resource,
        context: requestConditionContext(request, principal),
      });
    if (!result) throw denied();
    (request.iamDecisions ??= []).push({ ...result, action, resource });
    auditIamDecision({
      requestId: request.res?.locals.requestId,
      principal,
      action,
      resource,
      result,
      evaluationLatencyMs: performance.now() - start,
      authorizationMode: env.security.iamAuthorizationMode === "shadow" ? "shadow" : "enforce",
      ...(env.security.iamAuthorizationMode === "shadow" ? { legacyAllowed: true } : {}),
    });
    return result.decision === "Allow";
  }
  async prepareCreate(
    userId: string,
    input: { name?: string; expiresAt?: Date; channelId?: string },
    request?: TypedRequest,
  ) {
    const identity = request && getIamPrincipal(request),
      data = { ...input };
    if (
      !request ||
      !identity ||
      identity.subjectUserId !== userId ||
      identity.principalUserId !== userId ||
      !isCanonicalOjApiKeyId(userId)
    )
      throw denied();
    if (
      Object.keys(data).some((key) => !["name", "expiresAt", "channelId"].includes(key)) ||
      (data.name !== undefined && (typeof data.name !== "string" || data.name.length > 100)) ||
      (data.expiresAt !== undefined &&
        (!(data.expiresAt instanceof Date) || !Number.isFinite(data.expiresAt.getTime()))) ||
      (data.channelId !== undefined && !isCanonicalOjApiKeyId(data.channelId))
    )
      throw new BadRequestError("Invalid OJ API Key issuance", undefined, { messageKey: "errors.badRequest" });
    const principal = { ...identity };
    await this.iam.loadPolicies(principal);
    const required = [...new Set([userId, principal.accountOwnerId])],
      users = await this.users.targets(principal, required);
    if (
      users.length !== required.length ||
      required.some(
        (id) =>
          !users.some(
            (row) => row.id === id && row.updateTime instanceof Date && Number.isFinite(row.updateTime.getTime()),
          ),
      )
    )
      throw denied();
    const resource = buildAcsResource({
      service: "quyan",
      region: "*",
      accountId: principal.accountOwnerId,
      path: "user/" + userId,
    });
    const check = async () => {
      if (!(await this.decision(principal, request, "quyan:oj:CreateApiKey", resource))) throw denied();
    };
    await check();
    const channel = data.channelId
      ? await this.channels.assertChannelBusinessSelectableMetadataById(data.channelId, userId)
      : undefined;
    const recheck = async () => {
      await check();
      if (channel) {
        const current = await this.channels.assertChannelBusinessSelectableMetadataById(channel.id, userId);
        if (
          current.id !== channel.id ||
          current.updateTime.getTime() !== channel.updateTime.getTime() ||
          current.status !== channel.status
        )
          throw denied();
      }
    };
    const guard: OjApiKeyCreateGuard = {
      channel,
      identity: {
        principal,
        targetUserId: userId,
        users: users.map((row) => ({ id: row.id, updateTime: new Date(row.updateTime) })),
        recheck,
      },
    };
    return { data, guard };
  }
  async create(
    userId: string,
    input: { name?: string; expiresAt?: Date; channelId?: string },
    key: string,
    request?: TypedRequest,
  ) {
    const prepared = await this.prepareCreate(userId, input, request);
    return this.mutations.create({ ...prepared.data, userId, key }, prepared.guard);
  }
  async prepareUpdate(id: string, userId: string, input: OjApiKeyUpdateInput, request?: TypedRequest) {
    const identity = request && getIamPrincipal(request);
    if (
      !request ||
      !identity ||
      identity.subjectUserId !== userId ||
      identity.principalUserId !== userId ||
      !isCanonicalOjApiKeyId(id) ||
      !isCanonicalOjApiKeyId(userId)
    )
      throw denied();
    const principal = { ...identity },
      data = { ...input };
    if (
      Object.keys(data).some((key) => !["name", "expiresAt", "channelId"].includes(key)) ||
      (data.name !== undefined && (typeof data.name !== "string" || data.name.length > 100)) ||
      (data.expiresAt != null && (!(data.expiresAt instanceof Date) || !Number.isFinite(data.expiresAt.getTime()))) ||
      (data.channelId != null && !isCanonicalOjApiKeyId(data.channelId))
    )
      throw new BadRequestError("Invalid OJ API Key update", undefined, { messageKey: "errors.badRequest" });
    await this.iam.loadPolicies(principal);
    const target = await this.keys.target(principal, id);
    if (
      !target ||
      target.id !== id ||
      target.userId !== userId ||
      target.status !== 1 ||
      !(target.updateTime instanceof Date)
    )
      throw denied();
    const resource = ojApiKeyArn(principal.accountOwnerId, userId, id),
      required = [...new Set([userId, principal.accountOwnerId])],
      users = await this.users.targets(principal, required);
    if (
      users.length !== required.length ||
      required.some(
        (id) =>
          !users.some(
            (row) => row.id === id && row.updateTime instanceof Date && Number.isFinite(row.updateTime.getTime()),
          ),
      )
    )
      throw denied();
    const check = async () => {
      if (!(await this.decision(principal, request, "quyan:oj:UpdateApiKey", resource))) throw denied();
    };
    await check();
    const channel = data.channelId
      ? await this.channels.assertChannelBusinessSelectableMetadataById(data.channelId, userId)
      : undefined;
    const recheck = async () => {
      await check();
      if (channel) {
        const current = await this.channels.assertChannelBusinessSelectableMetadataById(channel.id, userId);
        if (
          current.id !== channel.id ||
          current.updateTime.getTime() !== channel.updateTime.getTime() ||
          current.status !== channel.status
        )
          throw denied();
      }
    };
    return {
      data,
      guard: {
        target: { ...target, updateTime: new Date(target.updateTime) },
        channel,
        identity: {
          principal,
          targetUserId: userId,
          users: users.map((row) => ({ id: row.id, updateTime: new Date(row.updateTime) })),
          recheck,
        },
        canReveal: () => this.decision(principal, request, "quyan:oj:RevealApiKey", resource),
      },
    };
  }
  async update(id: string, userId: string, input: OjApiKeyUpdateInput, request?: TypedRequest) {
    const prepared = await this.prepareUpdate(id, userId, input, request);
    return this.mutations.update(prepared.data, prepared.guard);
  }
}
