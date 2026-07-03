const MONTHLY_PASS_COVERAGE_PATTERNS = [/^\s*月卡抵扣\s*[:：]/, /^\s*monthly\s+pass\s+coverage\b/i];

const LEGACY_MONTHLY_PASS_AMOUNT_PATTERNS = [
  /^\s*月卡抵扣\s*[:：].*?[（(]\s*曲\s*([0-9]+(?:\.[0-9]+)?)\s*[)）]\s*$/,
  /^\s*月卡抵扣\s*[:：].*?[（(]\s*[¥￥]\s*([0-9]+(?:\.[0-9]+)?)\s*[)）]\s*$/,
  /^\s*月卡抵扣\s*[:：].*?曲\s*([0-9]+(?:\.[0-9]+)?)\s*$/,
  /^\s*月卡抵扣\s*[:：].*?[¥￥]\s*([0-9]+(?:\.[0-9]+)?)\s*$/,
];

export const isMonthlyPassCoverageDescription = (description?: string | null): boolean => {
  if (!description) return false;

  const normalizedDescription = description.trim();
  return MONTHLY_PASS_COVERAGE_PATTERNS.some((pattern) => pattern.test(normalizedDescription));
};

export const extractLegacyMonthlyPassCoveredAmount = (description?: string | null): number => {
  if (!isMonthlyPassCoverageDescription(description)) return 0;

  const normalizedDescription = description?.trim() ?? "";
  for (const pattern of LEGACY_MONTHLY_PASS_AMOUNT_PATTERNS) {
    const match = normalizedDescription.match(pattern);
    const amount = Number(match?.[1] ?? 0);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }

  return 0;
};
