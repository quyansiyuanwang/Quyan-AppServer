import type { DocsLocale } from "@/docs/types";

export type GlossaryEntry = {
  id: string;
  aliases: string[];
  title: Record<DocsLocale, string>;
  description: Record<DocsLocale, string>;
};

export interface GlossaryModule {
  entries: GlossaryEntry[];
}

export interface GlossaryRegistry {
  entries: GlossaryEntry[];
  getEntry(entryId: string): GlossaryEntry | undefined;
  getEntriesByIds(entryIds: string[]): GlossaryEntry[];
  getEntriesForText(text: string): GlossaryEntry[];
}
