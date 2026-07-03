const asciiAliasPattern = /^[a-z0-9][a-z0-9 +./:-]*$/i;

export const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const matchesAlias = (normalizedText: string, alias: string) => {
  const normalizedAlias = alias.toLowerCase();

  if (asciiAliasPattern.test(alias)) {
    return new RegExp(`\\b${escapeRegExp(normalizedAlias)}\\b`, "i").test(
      normalizedText,
    );
  }

  return normalizedText.includes(normalizedAlias);
};
