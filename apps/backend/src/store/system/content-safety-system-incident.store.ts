import type { Prisma } from "@prisma/client";
import type { ContentSafetyIncidentQuery } from "@/api/dto/system/content-safety.dto";
import type { PlatformCollectionStore, PlatformCollectionTarget } from "./platform-collection.store";
import { CONTENT_SAFETY_INCIDENT_FIELDS } from "./content-safety-incident-view";
export interface ContentSafetySystemIncidentTarget extends PlatformCollectionTarget {
  revision: string;
  sortRank: number;
  ruleId: string | null;
  ruleOwnerUserId: string | null;
  ruleStatus: number | null;
}
export type ContentSafetySystemIncidentView = Prisma.ContentSafetyIncidentGetPayload<{
  select: typeof CONTENT_SAFETY_INCIDENT_FIELDS;
}> & {
  rule: { name: string; type: string; pattern?: string } | null;
  relayTokenName: string | null;
  channelName: string | null;
};
export interface ContentSafetySystemIncidentWhere {
  predicate: Prisma.Sql;
  ordering: Prisma.Sql;
}
export interface ContentSafetySystemIncidentStore
  extends PlatformCollectionStore<
    ContentSafetyIncidentQuery,
    ContentSafetySystemIncidentWhere,
    ContentSafetySystemIncidentTarget
  > {
  hydrate(
    where: ContentSafetySystemIncidentWhere,
    targets: readonly ContentSafetySystemIncidentTarget[],
    ruleIds: ReadonlySet<string>,
  ): Promise<ContentSafetySystemIncidentView[]>;
}
