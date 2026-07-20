const LEGACY_PLACEHOLDER_NAMES = new Set(["历史混池渠道", "历史渠道（未记录）"]);

export const UNATTRIBUTED_RELAY_CHANNEL_NAME = "未归属渠道";

export const normalizeRelayDisplaySnapshotName = (value?: string | null): string | undefined => {
  const normalized = value?.trim();
  return normalized && !LEGACY_PLACEHOLDER_NAMES.has(normalized) ? normalized : undefined;
};
