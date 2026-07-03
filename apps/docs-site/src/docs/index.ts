import { createDocsRegistry } from "@/docs/registry/createDocsRegistry";
import { registerAllDocs } from "@/docs/modules";

export type { DocsLocale, DocsPage, DocsRegistry } from "@/docs/types";

export const docsRegistry = createDocsRegistry({
  defaultSlug: "getting-started",
  register: registerAllDocs,
});

export type DocsSlug = (typeof docsRegistry.pages)[number]["slug"];
