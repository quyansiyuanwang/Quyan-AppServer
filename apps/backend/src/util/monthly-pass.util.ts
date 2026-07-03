export interface MonthlyPassTemplateLike {
  allowedModels?: string | null;
  allowedChannels?: string | null;
}

const parseJsonStringArray = (value?: string | null): string[] | null => {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;

    const cleaned = parsed.map((item) => String(item || "").trim()).filter(Boolean);
    return cleaned;
  } catch {
    return null;
  }
};

export const serializeStringArray = (value?: string[] | null): string | null => {
  if (!value || value.length === 0) return null;

  const cleaned = value.map((item) => String(item || "").trim()).filter(Boolean);
  if (cleaned.length === 0) return null;

  return JSON.stringify(Array.from(new Set(cleaned)));
};

export const parseAllowedModels = (value?: string | null): string[] | null => {
  return parseJsonStringArray(value);
};

export const parseAllowedChannels = (value?: string | null): string[] | null => {
  return parseJsonStringArray(value);
};

export const isMonthlyPassTemplateMatched = (
  template: MonthlyPassTemplateLike,
  modelName: string,
  channelId: string,
): boolean => {
  const allowedModels = parseAllowedModels(template.allowedModels);
  const allowedChannels = parseAllowedChannels(template.allowedChannels);

  const normalizedModelName = (modelName || "").trim();

  const isModelMatched =
    !allowedModels ||
    allowedModels.length === 0 ||
    (normalizedModelName.length > 0 && allowedModels.includes(normalizedModelName));
  const isChannelMatched = !allowedChannels || allowedChannels.length === 0 || allowedChannels.includes(channelId);

  return isModelMatched && isChannelMatched;
};
