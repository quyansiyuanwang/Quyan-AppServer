import type { DocsRegistryBuilder, DocsPageModule } from "@/docs/types";

const modules = import.meta.glob<DocsPageModule>("./*.doc.ts", {
  eager: true,
  import: "default",
});

const orderedModulePaths = [
  "./relay-token-management.doc.ts",
  "./relay-settings.doc.ts",
  "./upstream-status.doc.ts",
  "./remote-terminal.doc.ts",
  "./remote-terminal-management.doc.ts",
] as const;

export const registerRelayDocs = (registry: DocsRegistryBuilder) => {
  orderedModulePaths.forEach((modulePath) => {
    const page = modules[modulePath];
    if (!page) {
      throw new Error(`Missing docs module: ${modulePath}`);
    }
    registry.registerPage(page);
  });
};
