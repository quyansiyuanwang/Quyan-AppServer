import { Prisma } from "@prisma/client";
import type { IamPrincipal } from "@quyan/shared";
import { prisma } from "@/config/database";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isRemoteTerminalId } from "@/iam/resources/remote-terminal-resources";
import { assertIamAccountPrincipal, iamAccountDenied } from "../users/iam-account-principal";
import type { RemoteTerminalDeviceSummary } from "@/modules/remote-terminal/protocol";
import { REMOTE_TERMINAL_PROTOCOL_SHELL_TYPES } from "@/modules/remote-terminal/protocol";
import type { RemoteTerminalDeviceReadStore, RemoteTerminalDeviceTarget } from "./remote-terminal-device-read.store";

import { assertTerminalDeviceTargets } from "./remote-terminal-device-snapshot";

const source = Prisma.sql`remote_terminal_device_bindings b
  JOIN remote_terminal_user_entitlements e ON e.id=b.entitlementId
  JOIN users u ON u.id=b.userId`;
// Revisions cover actual contributing values, including edits that preserve updateTime.
const controlRevision = Prisma.sql`SHA2(CAST(JSON_ARRAY(b.id,b.deviceId,b.userId,b.status,b.entitlementId,e.userId,e.status,e.startAt,e.endAt,u.id,u.accountOwnerId,u.status) AS CHAR),256)`;
const summaryRevision = Prisma.sql`SHA2(CAST(JSON_ARRAY(${controlRevision},b.hostname,b.platform,b.arch,b.registeredAt,b.lastSeenAt,b.online,JSON_EXTRACT(b.snapshot,'$.diagnostics.availableShells')) AS CHAR),256)`;
const metadata = Prisma.sql`b.id,b.deviceId,b.userId,${controlRevision} AS controlRevision,${summaryRevision} AS summaryRevision`;
function where(principal: IamPrincipal) {
  const at = new Date();
  return Prisma.sql`BINARY b.userId=BINARY ${principal.subjectUserId} AND BINARY u.id=BINARY b.userId AND b.status=1 AND BINARY e.userId=BINARY b.userId AND e.status=1
    AND e.startAt<=${at} AND e.endAt>=${at} AND u.status=1
    AND (BINARY u.accountOwnerId=BINARY ${principal.accountOwnerId} OR (BINARY u.id=BINARY ${principal.accountOwnerId} AND u.accountOwnerId IS NULL))`;
}
export class RemoteTerminalDeviceReadRepository implements RemoteTerminalDeviceReadStore {
  private static instance: RemoteTerminalDeviceReadRepository;
  static getInstance() {
    return (this.instance ??= new RemoteTerminalDeviceReadRepository());
  }
  private ids(ids: readonly string[]) {
    if (
      !ids.length ||
      ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !isRemoteTerminalId(id))
    )
      throw iamAccountDenied();
  }
  async scan(principal: IamPrincipal, after?: string) {
    await assertIamAccountPrincipal(principal);
    if (after !== undefined && !isRemoteTerminalId(after)) throw iamAccountDenied();
    return prisma.$queryRaw<
      RemoteTerminalDeviceTarget[]
    >(Prisma.sql`SELECT ${metadata} FROM ${source} WHERE ${where(principal)}
      ${after ? Prisma.sql`AND b.id>${after}` : Prisma.empty} ORDER BY b.id ASC LIMIT ${IAM_AUTHORIZATION_LIMITS.resourcesPerRequest}`);
  }
  async targets(principal: IamPrincipal, deviceIds: readonly string[]) {
    await assertIamAccountPrincipal(principal);
    this.ids(deviceIds);
    const rows = await prisma.$queryRaw<RemoteTerminalDeviceTarget[]>(
      Prisma.sql`SELECT ${metadata} FROM ${source} WHERE ${where(principal)} AND b.deviceId IN (${Prisma.join([...deviceIds])})`,
    );
    // MySQL collations must never turn a case alias into a different authorized resource.
    if (rows.some((row) => !deviceIds.includes(row.deviceId) || row.userId !== principal.subjectUserId))
      throw iamAccountDenied();
    return rows;
  }
  async hydrate(principal: IamPrincipal, expected: readonly RemoteTerminalDeviceTarget[]) {
    if (!expected.length) return [];
    const ids = expected.map((row) => row.deviceId);
    await assertIamAccountPrincipal(principal);
    this.ids(ids);
    type Row = RemoteTerminalDeviceTarget & {
      hostname: string;
      platform: string;
      arch: string;
      availableShells: unknown;
      lastSeenAt: Date;
      registeredAt: Date;
      online: boolean | number;
    };
    const records = await prisma.$queryRaw<Row[]>(Prisma.sql`SELECT ${metadata},b.hostname,b.platform,b.arch,
      JSON_EXTRACT(b.snapshot,'$.diagnostics.availableShells') AS availableShells,b.lastSeenAt,b.registeredAt,b.online
      FROM ${source} WHERE ${where(principal)} AND b.deviceId IN (${Prisma.join(ids)})`);
    assertTerminalDeviceTargets(records, expected);
    const result = expected.map((target) => {
      const row = records.find((item) => item.deviceId === target.deviceId)!;
      const shells =
        typeof row.availableShells === "string" ? JSON.parse(row.availableShells) : (row.availableShells ?? []);
      if (
        !["windows", "linux", "macos"].includes(row.platform) ||
        !Array.isArray(shells) ||
        shells.some((value) => !REMOTE_TERMINAL_PROTOCOL_SHELL_TYPES.includes(value))
      )
        throw iamAccountDenied();
      return {
        deviceId: row.deviceId,
        hostname: row.hostname,
        platform: row.platform as RemoteTerminalDeviceSummary["platform"],
        arch: row.arch,
        availableShells: shells,
        lastSeenAt: row.lastSeenAt.toISOString(),
        registeredAt: row.registeredAt.toISOString(),
        online: Boolean(row.online),
      };
    });
    assertTerminalDeviceTargets(await this.targets(principal, ids), expected);
    return result;
  }
}
