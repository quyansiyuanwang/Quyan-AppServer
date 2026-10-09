import type { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import type {
  CreateDeveloperPushChannelDto,
  DeveloperPushChannelDto,
  DeveloperPushSecretReferenceDto,
  UpdateDeveloperPushChannelDto,
} from "@/api/dto/developer/developer.dto";
import { developerProjectIdSchema, developerSecretAliasSchema } from "@/api/schema/developer/developer.schema";
import { isCanonicalDeveloperIdentifier } from "@/iam/resources/developer-resources";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/util/errors";
import { assertSafeOutboundUrl } from "@/util/developer-outbound-url";
import {
  readStoredPushSecretReference,
  requiresPushSecretAuthority,
  toDeveloperPushChannelDto,
  type PushChannelSnapshot,
  type StoredPushSecretReference,
} from "./developer-push-channel.mapping";

export interface ResolvedPushSecretBinding extends StoredPushSecretReference {
  alias: string;
}
const channelSelect = {
  id: true,
  projectId: true,
  name: true,
  type: true,
  endpoint: true,
  secretAlias: true,
  config: true,
  enabled: true,
  createTime: true,
  updateTime: true,
} satisfies Prisma.DeveloperPushChannelSelect;
/** JWT management persistence only. Product keys, dispatch and retries keep their independent boundary. */
export class DeveloperPushChannelRepository {
  private static instance: DeveloperPushChannelRepository;
  private constructor() {}
  static getInstance() {
    return (this.instance ??= new DeveloperPushChannelRepository());
  }
  private activeWhere(projectId: string, userId: string, id?: string): Prisma.DeveloperPushChannelWhereInput {
    return { id, projectId, status: 1, project: { status: 1, userId, user: { status: 1 } } };
  }
  private unavailable(): never {
    throw new NotFoundError("Push channel is unavailable", undefined, {
      messageKey: "developerProject.pushChannelNotFound",
    });
  }
  private changed(): never {
    throw new ForbiddenError("Push channel authorization snapshot changed", undefined, {
      messageKey: "permission.insufficientPermission",
    });
  }
  private async assertProject(tx: Prisma.TransactionClient, projectId: string, userId: string): Promise<void> {
    const project = await tx.developerProject.findFirst({
      where: { id: projectId, userId, status: 1, user: { status: 1 } },
      select: { id: true, userId: true },
    });
    if (!project || project.id !== projectId || project.userId !== userId) this.unavailable();
  }
  async listCandidates(
    projectId: string,
    userId: string,
    options: { skip: number; take: number },
  ): Promise<DeveloperPushChannelDto[]> {
    const rows = await prisma.developerPushChannel.findMany({
      where: this.activeWhere(projectId, userId),
      select: channelSelect,
      orderBy: [{ createTime: "desc" }, { id: "asc" }],
      ...options,
    });
    return rows.map(toDeveloperPushChannelDto);
  }
  async snapshot(projectId: string, userId: string, id: string): Promise<PushChannelSnapshot> {
    const row = await prisma.developerPushChannel.findFirst({
      where: this.activeWhere(projectId, userId, id),
      select: channelSelect,
    });
    if (!row || row.id !== id || row.projectId !== projectId) this.unavailable();
    return row;
  }
  /** Resolves live credential metadata, never ciphertext, plaintext, or lastUsedAt. */
  async findSecretBinding(
    userId: string,
    reference: DeveloperPushSecretReferenceDto,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<ResolvedPushSecretBinding> {
    if (
      !isCanonicalDeveloperIdentifier(developerProjectIdSchema, reference.secretInstanceId) ||
      !isCanonicalDeveloperIdentifier(developerSecretAliasSchema, reference.alias)
    )
      throw new BadRequestError("Invalid Secret reference", undefined, {
        messageKey: "developerProject.selectedVaultProjectUnavailable",
      });
    const now = new Date();
    const instance = await tx.developerProductInstance.findFirst({
      where: {
        id: reference.secretInstanceId,
        status: 1,
        enabled: true,
        backingProject: { status: 1, userId, user: { status: 1 } },
        entitlement: {
          productCode: "secret",
          status: 1,
          accountOwnerId: userId,
          enabled: true,
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          ],
        },
      },
      select: { id: true, backingProjectId: true },
    });
    if (!instance || instance.id !== reference.secretInstanceId)
      throw new BadRequestError("Selected Secret instance is unavailable", undefined, {
        messageKey: "developerProject.selectedVaultProjectUnavailable",
      });
    const secret = await tx.developerSecret.findFirst({
      where: { projectId: instance.backingProjectId, alias: reference.alias, status: 1 },
      select: { projectId: true, alias: true },
    });
    if (!secret || secret.projectId !== instance.backingProjectId || secret.alias !== reference.alias)
      throw new BadRequestError("Selected Secret alias is unavailable", undefined, {
        messageKey: "developerProject.selectedVaultProjectUnavailable",
      });
    return { secretInstanceId: instance.id, secretProjectId: instance.backingProjectId, alias: secret.alias };
  }
  private async assertBinding(
    tx: Prisma.TransactionClient,
    userId: string,
    reference: DeveloperPushSecretReferenceDto,
    expected?: ResolvedPushSecretBinding,
  ): Promise<ResolvedPushSecretBinding> {
    if (!expected || expected.secretInstanceId !== reference.secretInstanceId || expected.alias !== reference.alias)
      this.changed();
    const live = await this.findSecretBinding(userId, reference, tx);
    if (live.secretProjectId !== expected.secretProjectId) this.changed();
    return live;
  }
  async create(
    projectId: string,
    userId: string,
    body: CreateDeveloperPushChannelDto,
    binding?: ResolvedPushSecretBinding,
  ): Promise<DeveloperPushChannelDto> {
    const endpoint = (await assertSafeOutboundUrl(body.endpoint)).url.toString();
    const record = await prisma.$transaction(
      async (tx) => {
        await this.assertProject(tx, projectId, userId);
        const live = body.secretReference
          ? await this.assertBinding(tx, userId, body.secretReference, binding)
          : undefined;
        return tx.developerPushChannel.create({
          data: {
            projectId,
            name: body.name,
            type: body.type,
            endpoint,
            secretAlias: live?.alias,
            config: live
              ? { secretInstanceId: live.secretInstanceId, secretProjectId: live.secretProjectId }
              : undefined,
          },
          select: channelSelect,
        });
      },
      { isolationLevel: "Serializable" },
    );
    return toDeveloperPushChannelDto(record);
  }
  async update(
    snapshot: PushChannelSnapshot,
    userId: string,
    body: UpdateDeveloperPushChannelDto,
    binding?: ResolvedPushSecretBinding,
  ): Promise<DeveloperPushChannelDto> {
    const endpoint =
      body.endpoint === undefined ? undefined : (await assertSafeOutboundUrl(body.endpoint)).url.toString();
    const record = await prisma.$transaction(
      async (tx) => {
        await this.assertProject(tx, snapshot.projectId, userId);
        const current = await tx.developerPushChannel.findFirst({
          where: this.activeWhere(snapshot.projectId, userId, snapshot.id),
          select: channelSelect,
        });
        if (!current || current.id !== snapshot.id || current.projectId !== snapshot.projectId) this.unavailable();
        // Timestamp alone is insufficient when two writes share a database timestamp tick.
        if (
          current.updateTime.getTime() !== snapshot.updateTime.getTime() ||
          current.endpoint !== snapshot.endpoint ||
          current.secretAlias !== snapshot.secretAlias ||
          current.enabled !== snapshot.enabled ||
          JSON.stringify(current.config) !== JSON.stringify(snapshot.config)
        )
          this.changed();
        let reference = body.secretReference === undefined ? readStoredPushSecretReference(current.config) : undefined;
        let alias = body.secretReference === undefined ? current.secretAlias : (body.secretReference?.alias ?? null);
        if (requiresPushSecretAuthority(body, current)) {
          const requested =
            body.secretReference ??
            (reference && current.secretAlias
              ? { secretInstanceId: reference.secretInstanceId, alias: current.secretAlias }
              : undefined);
          if (!requested) this.changed();
          const live = await this.assertBinding(tx, userId, requested, binding);
          if (body.secretReference === undefined && reference?.secretProjectId !== live.secretProjectId) this.changed();
          reference = live;
          alias = live.alias;
        }
        const config =
          current.config && typeof current.config === "object" && !Array.isArray(current.config)
            ? { ...(current.config as Record<string, unknown>) }
            : {};
        delete config.secretInstanceId;
        delete config.secretProjectId;
        if (reference) {
          config.secretInstanceId = reference.secretInstanceId;
          config.secretProjectId = reference.secretProjectId;
        }
        const result = await tx.developerPushChannel.updateMany({
          where: this.activeWhere(current.projectId, userId, current.id),
          data: {
            name: body.name,
            endpoint,
            secretAlias: alias,
            config: config as Prisma.InputJsonValue,
            enabled: body.enabled,
          },
        });
        if (result.count !== 1) this.unavailable();
        const updated = await tx.developerPushChannel.findFirst({
          where: this.activeWhere(current.projectId, userId, current.id),
          select: channelSelect,
        });
        if (!updated) this.unavailable();
        return updated;
      },
      { isolationLevel: "Serializable" },
    );
    return toDeveloperPushChannelDto(record);
  }
  async delete(projectId: string, userId: string, id: string): Promise<void> {
    await prisma.$transaction(
      async (tx) => {
        await this.assertProject(tx, projectId, userId);
        const row = await tx.developerPushChannel.findFirst({
          where: this.activeWhere(projectId, userId, id),
          select: { id: true, projectId: true },
        });
        if (!row || row.id !== id || row.projectId !== projectId) this.unavailable();
        const result = await tx.developerPushChannel.deleteMany({ where: this.activeWhere(projectId, userId, id) });
        if (result.count !== 1) this.unavailable();
      },
      { isolationLevel: "Serializable" },
    );
  }
}
