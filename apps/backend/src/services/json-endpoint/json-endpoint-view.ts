import type { JsonEndpoint } from "@prisma/client";
import type { JsonEndpointPublicView } from "@/store/system/json-endpoint-management.store";
import type { JsonEndpointDto } from "@/api/dto/json-endpoint/json-endpoint.dto";
export function jsonEndpointPublicPath(endpoint: Pick<JsonEndpoint, "isRootSlug" | "slug">, ownerUsername: string) {
  return endpoint.isRootSlug ? `/v1/json/${endpoint.slug}` : `/v1/json/${ownerUsername}/${endpoint.slug}`;
}
export function jsonEndpointDto(
  endpoint: JsonEndpoint | JsonEndpointPublicView,
  ownerUsername: string,
): JsonEndpointDto {
  const accessMode = endpoint.isPublic
    ? undefined
    : endpoint.accessMode === "public-key"
      ? "public-key"
      : "static-password";
  return {
    id: endpoint.id,
    userId: endpoint.userId,
    ownerUsername,
    name: endpoint.name,
    slug: endpoint.slug,
    isRootSlug: endpoint.isRootSlug,
    publicUrl: jsonEndpointPublicPath(endpoint, ownerUsername),
    description: endpoint.description || undefined,
    jsonContent: endpoint.jsonContent,
    isPublic: endpoint.isPublic,
    hasPassword:
      accessMode === "static-password" && ("hasPassword" in endpoint ? endpoint.hasPassword : !!endpoint.apiKey),
    hasPublicKey: accessMode === "public-key" && !!endpoint.publicKey,
    accessMode,
    publicKey: endpoint.publicKey || undefined,
    publicKeyFingerprint: endpoint.publicKeyFingerprint || undefined,
    signatureAlgorithm: endpoint.signatureAlgorithm || undefined,
    accessCount: endpoint.accessCount,
    lastAccessAt: endpoint.lastAccessAt?.toISOString(),
    createTime: endpoint.createTime.toISOString(),
    updateTime: endpoint.updateTime.toISOString(),
  };
}
