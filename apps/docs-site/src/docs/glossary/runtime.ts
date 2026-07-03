import { createGlossaryRegistry } from "@/docs/glossary/createGlossaryRegistry";
import { glossaryModules } from "@/docs/glossary/modules";

export const glossaryRegistry = createGlossaryRegistry(glossaryModules);
