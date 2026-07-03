import type { DocsRegistryBuilder, DocsPageModule } from "@/docs/types";

const modules = import.meta.glob<DocsPageModule>("./*.doc.ts", {
  eager: true,
  import: "default",
});

const orderedModulePaths = [
  "./api-documentation.doc.ts",
  "./node-sdk.doc.ts",
  "./python-sdk.doc.ts",
  "./auth-center-node-sdk.doc.ts",
  "./auth-center-python-sdk.doc.ts",
  "./auth-center-browser-spa-example.doc.ts",
  "./oauth-demo.doc.ts",
  "./sdk-examples.doc.ts",
] as const;

export const registerReferenceDocs = (registry: DocsRegistryBuilder) => {
  orderedModulePaths.forEach((modulePath) => {
    const page = modules[modulePath];
    if (!page) {
      throw new Error(`Missing docs module: ${modulePath}`);
    }
    registry.registerPage(page);
  });
};
