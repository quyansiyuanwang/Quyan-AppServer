import type { DocsRegistryBuilder, DocsPageModule } from "@/docs/types";

const modules = import.meta.glob<DocsPageModule>("./*.doc.ts", {
  eager: true,
  import: "default",
});

const orderedModulePaths = ["./home-articles.doc.ts"] as const;

export const registerContentDocs = (registry: DocsRegistryBuilder) => {
  orderedModulePaths.forEach((modulePath) => {
    const page = modules[modulePath];
    if (!page) {
      throw new Error(`Missing docs module: ${modulePath}`);
    }
    registry.registerPage(page);
  });
};
