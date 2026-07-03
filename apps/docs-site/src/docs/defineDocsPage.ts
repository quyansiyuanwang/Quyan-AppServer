import type { DocsPage, DocsPageInput } from "@/docs/types";

const DEFAULT_UPDATED_AT = "2026-05-23";

export const defineDocsPage = (input: DocsPageInput): DocsPage => ({
  ...input,
  updatedAt: input.updatedAt ?? DEFAULT_UPDATED_AT,
});
