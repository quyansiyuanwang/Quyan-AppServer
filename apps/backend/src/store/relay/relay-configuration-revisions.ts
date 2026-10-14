import { Prisma } from "@prisma/client";
// Hash the exact visible projection inputs in SQL; unauthorized payloads never enter the service.
export const configRevision = Prisma.sql`SHA2(CAST(JSON_ARRAY(id, status, globalMultiplier, maxConcurrency, queueTimeout, upstreamStreamTimeout, preflightBufferLimitBytes, enableQueue, apiCatalogPoolVisibility, channelTopologyMode, uptimeStatusUrl, monitorNameMapping, showOnlyConfigured, uptimeTransformRules, uptimeStaticData) AS CHAR),256)`;
export const priceRevision = Prisma.sql`SHA2(CAST(JSON_ARRAY(id, status, model, pricingType, inputPrice, outputPrice, fixedPrice, provider, cacheCreationMultiplier, cacheReadMultiplier, supportedFormats) AS CHAR),256)`;
