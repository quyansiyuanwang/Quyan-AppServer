import { glossaryModules } from "@/docs/glossary/modules";
export type { GlossaryEntry, GlossaryModule, GlossaryRegistry } from "./types";
import { createGlossaryRegistry } from "@/docs/glossary/createGlossaryRegistry";

export const glossaryRegistry = createGlossaryRegistry(glossaryModules);
