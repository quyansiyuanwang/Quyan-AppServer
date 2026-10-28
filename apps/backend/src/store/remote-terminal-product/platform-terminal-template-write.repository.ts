import { readIamAuthorizationRevision } from "../users/iam-authorization-revision";
import { createHash } from "node:crypto";
import { Prisma, type RemoteTerminalProductTemplate } from "@prisma/client";
import { Permission, type IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { isPlatformLogResourceId } from "@/iam/resources/platform-log-resources";
import { platformManagementGroupSnapshot } from "../users/platform-management-principal";
import { assertIamAccountUserMutation } from "../users/iam-account-user-mutation";
import { iamAccountDenied } from "../users/iam-account-principal";
import { BadRequestError, ConflictError } from "@/util/errors";
import type {
  PlatformTerminalTemplateWriteStore,
  TerminalTemplateWriteTarget,
  TerminalTemplateWriteGuard,
} from "./platform-terminal-template-write.store";
/** Hash all persisted scalars, including prices, rather than relying on updateTime alone. */
export function terminalTemplateRevision(row: RemoteTerminalProductTemplate) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(row)
          .sort()
          .map((key) => [key, row[key as keyof typeof row]]),
      ),
    )
    .digest("hex");
}
export class PlatformTerminalTemplateWriteRepository implements PlatformTerminalTemplateWriteStore {
  private static instance: PlatformTerminalTemplateWriteRepository;
  static getInstance() {
    return (this.instance ??= new PlatformTerminalTemplateWriteRepository());
  }
  async target(principal: IamPrincipal, id: string) {
    if (!isPlatformLogResourceId(id)) throw iamAccountDenied();
    await platformManagementGroupSnapshot(principal, Permission.REMOTE_TERMINAL_PRODUCT_WRITE);
    const record = await prisma.remoteTerminalProductTemplate.findFirst({ where: { id, status: { in: [0, 1] } } });
    return record ? { record, revision: terminalTemplateRevision(record) } : null;
  }
  private async identity(tx: Prisma.TransactionClient, guard: TerminalTemplateWriteGuard) {
    if (guard.users.targetUserId !== guard.users.principal.subjectUserId) throw iamAccountDenied();
    await assertIamAccountUserMutation(tx, guard.users, guard.users.targetUserId);
    await tx.$queryRaw`SELECT id FROM \`groups\` WHERE id=${guard.group.id} FOR UPDATE`;
    const current = await platformManagementGroupSnapshot(
      guard.users.principal,
      Permission.REMOTE_TERMINAL_PRODUCT_WRITE,
      tx,
    );
    if (current.id !== guard.group.id || current.updateTime.getTime() !== guard.group.updateTime.getTime())
      throw iamAccountDenied();
  }
  private async transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new ConflictError("Template mutation source changed", undefined, { messageKey: "errors.conflict" });
      throw error;
    }
  }
  private async nameAvailable(tx: Prisma.TransactionClient, name: string, id?: string) {
    await tx.$queryRaw`SELECT id FROM remote_terminal_product_templates WHERE name=${name} AND status>=0 FOR UPDATE`;
    if (
      await tx.remoteTerminalProductTemplate.findFirst({
        where: { name, status: { gte: 0 }, ...(id ? { id: { not: id } } : {}) },
        select: { id: true },
      })
    )
      throw new BadRequestError("Template name already exists", undefined, {
        messageKey: "remoteTerminalProduct.templateNameExists",
      });
  }
  async create(data: Prisma.RemoteTerminalProductTemplateUncheckedCreateInput, guard: TerminalTemplateWriteGuard) {
    if (
      guard.operation !== "CreateTemplate" ||
      data.id !== undefined ||
      data.status !== 1 ||
      data.publishStatus !== "draft"
    )
      throw iamAccountDenied();
    return this.transaction(async (tx) => {
      await this.identity(tx, guard);
      const authorizationRevision = await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId);
      await this.nameAvailable(tx, data.name);
      await guard.users.recheck();
      const row = await tx.remoteTerminalProductTemplate.create({ data });
      await this.identity(tx, guard);
      await guard.recheckEntry(row.id);
      if ((await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== authorizationRevision)
        throw iamAccountDenied();
      return row;
    });
  }
  async mutate(
    target: TerminalTemplateWriteTarget,
    data: Prisma.RemoteTerminalProductTemplateUncheckedUpdateInput,
    guard: TerminalTemplateWriteGuard,
  ) {
    if (
      guard.operation === "CreateTemplate" ||
      !isPlatformLogResourceId(target.record.id) ||
      data.id !== undefined ||
      data.createTime !== undefined ||
      data.updateTime !== undefined
    )
      throw iamAccountDenied();
    if (
      (data.status !== undefined && (typeof data.status !== "number" || ![-1, 0, 1].includes(data.status))) ||
      (guard.operation === "UpdateTemplate" &&
        (data.publishStatus !== undefined ||
          data.publishedAt !== undefined ||
          (data.status === -1 && !guard.deleteViaUpdate))) ||
      (guard.operation === "DeleteTemplate" &&
        (data.status !== -1 || data.publishStatus !== "draft" || data.publishedAt !== null)) ||
      (guard.operation === "PublishTemplate" &&
        (data.publishStatus !== "published" || !(data.publishedAt instanceof Date))) ||
      (guard.operation === "UnpublishTemplate" && (data.publishStatus !== "draft" || data.publishedAt !== null))
    )
      throw iamAccountDenied();
    if (guard.operation !== "UpdateTemplate") {
      const allowedKeys =
        guard.operation === "DeleteTemplate"
          ? ["status", "publishStatus", "publishedAt"]
          : ["publishStatus", "publishedAt"];
      if (Object.keys(data).some((key) => !allowedKeys.includes(key))) throw iamAccountDenied();
    }
    return this.transaction(async (tx) => {
      await this.identity(tx, guard);
      const authorizationRevision = await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId);
      await tx.$queryRaw`SELECT id FROM remote_terminal_product_templates WHERE id=${target.record.id} FOR UPDATE`;
      const current = await tx.remoteTerminalProductTemplate.findUnique({ where: { id: target.record.id } });
      if (
        !current ||
        ![0, 1].includes(current.status) ||
        terminalTemplateRevision(current) !== target.revision ||
        terminalTemplateRevision(target.record) !== target.revision
      )
        throw iamAccountDenied();
      if (typeof data.name === "string" && data.name !== current.name)
        await this.nameAvailable(tx, data.name, current.id);
      if (guard.operation === "PublishTemplate" && current.status !== 1) throw iamAccountDenied();
      await guard.recheckEntry(current.id);
      const row = await tx.remoteTerminalProductTemplate.update({ where: { id: current.id }, data });
      await this.identity(tx, guard);
      await guard.recheckEntry(row.id);
      if ((await readIamAuthorizationRevision(tx, guard.users.principal.accountOwnerId)) !== authorizationRevision)
        throw iamAccountDenied();
      return row;
    });
  }
}
