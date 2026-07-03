import { matchesAlias } from "@/docs/glossary/matcher";
import type {
  GlossaryEntry,
  GlossaryModule,
  GlossaryRegistry,
} from "@/docs/glossary/types";

export const createGlossaryRegistry = (
  modules: GlossaryModule[],
): GlossaryRegistry => {
  const entries: GlossaryEntry[] = [];
  const entryById = new Map<string, GlossaryEntry>();
  const aliasOwnerByNormalizedAlias = new Map<string, string>();

  for (const module of modules) {
    for (const entry of module.entries) {
      if (entryById.has(entry.id)) {
        throw new Error(`Duplicate glossary entry id: ${entry.id}`);
      }

      for (const alias of entry.aliases) {
        const normalizedAlias = alias.trim().toLowerCase();
        if (!normalizedAlias) {
          throw new Error(`Empty glossary alias in entry: ${entry.id}`);
        }

        const aliasOwner = aliasOwnerByNormalizedAlias.get(normalizedAlias);
        if (aliasOwner && aliasOwner !== entry.id) {
          throw new Error(
            `Duplicate glossary alias "${alias}" used by ${aliasOwner} and ${entry.id}`,
          );
        }

        aliasOwnerByNormalizedAlias.set(normalizedAlias, entry.id);
      }

      entries.push(entry);
      entryById.set(entry.id, entry);
    }
  }

  return {
    entries,
    getEntry(entryId) {
      return entryById.get(entryId);
    },
    getEntriesByIds(entryIds) {
      return entryIds
        .map((entryId) => entryById.get(entryId))
        .filter((entry): entry is GlossaryEntry => !!entry);
    },
    getEntriesForText(text) {
      const normalizedText = text.toLowerCase();

      return entries.filter((entry) =>
        entry.aliases.some((alias) => matchesAlias(normalizedText, alias)),
      );
    },
  };
};
