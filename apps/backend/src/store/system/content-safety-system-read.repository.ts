import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/config/database";
import { CONFIG_KEYS } from "@/constant/config-keys";
import { IAM_AUTHORIZATION_LIMITS } from "@/iam/authorization-limits";
import { isContentSafetyRuleId } from "@/iam/resources/content-safety-system-resources";
import { iamAccountDenied } from "../users/iam-account-principal";
import type { PlatformCollectionCursor } from "./platform-collection.store";
import type { ContentSafetySystemReadStore, ContentSafetySystemRuleTarget } from "./content-safety-system-read.store";
import {
  CONTENT_SAFETY_SYSTEM_RULE_METADATA as metadata,
  readContentSafetySystemRuleTargets,
  sameContentSafetySystemRuleTargets,
} from "./content-safety-system-rule-snapshot";
export class ContentSafetySystemReadRepository implements ContentSafetySystemReadStore {
  private static instance: ContentSafetySystemReadRepository;
  static getInstance() {
    return (this.instance ??= new ContentSafetySystemReadRepository());
  }
  async where() {
    return true as const;
  }
  private cursor(value: PlatformCollectionCursor) {
    if (
      !isContentSafetyRuleId(value.id) ||
      !(value.createTime instanceof Date) ||
      !Number.isFinite(value.createTime.getTime())
    )
      throw iamAccountDenied();
  }
  scan(_where: true, after?: PlatformCollectionCursor, boundary?: PlatformCollectionCursor) {
    if (after) this.cursor(after);
    if (boundary) this.cursor(boundary);
    return prisma.$queryRaw<
      ContentSafetySystemRuleTarget[]
    >(Prisma.sql`SELECT ${metadata} FROM content_safety_rules WHERE status=1 AND ownerUserId IS NULL
      ${after ? Prisma.sql`AND (createTime<${after.createTime} OR (createTime=${after.createTime} AND id<${after.id}))` : Prisma.empty}
      ${boundary ? Prisma.sql`AND (createTime<${boundary.createTime} OR (createTime=${boundary.createTime} AND id<=${boundary.id}))` : Prisma.empty}
      ORDER BY createTime DESC,id DESC LIMIT ${IAM_AUTHORIZATION_LIMITS.resourcesPerRequest}`);
  }
  async hydrate(expected: readonly ContentSafetySystemRuleTarget[]) {
    if (!expected.length) return [];
    const ids = expected.map((row) => row.id);
    if (
      ids.length > IAM_AUTHORIZATION_LIMITS.resourcesPerRequest ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !isContentSafetyRuleId(id))
    )
      throw iamAccountDenied();
    sameContentSafetySystemRuleTargets(await readContentSafetySystemRuleTargets(prisma, ids), expected);
    const rows = await prisma.contentSafetyRule.findMany({ where: { status: 1, ownerUserId: null, id: { in: ids } } });
    if (
      rows.length !== expected.length ||
      rows.some(
        (row) =>
          !expected.some((target) => row.id === target.id && row.updateTime.getTime() === target.updateTime.getTime()),
      )
    )
      throw iamAccountDenied();
    sameContentSafetySystemRuleTargets(await readContentSafetySystemRuleTargets(prisma, ids), expected);
    return expected.map((target) => rows.find((row) => row.id === target.id)!);
  }
  async configuration() {
    const rows = await prisma.serverConfig.findMany({
      where: { key: { in: Object.values(CONFIG_KEYS.CONTENT_SAFETY) } },
      select: { key: true, value: true, status: true, updateTime: true },
      orderBy: { key: "asc" },
    });
    if (rows.some((row) => row.status !== 1)) throw iamAccountDenied();
    return {
      values: Object.fromEntries(rows.map((row) => [row.key, row.value])),
      revision: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    };
  }
}
