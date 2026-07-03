import type { DocsRegistryBuilder, DocsPageModule } from "@/docs/types";

const modules = import.meta.glob<DocsPageModule>("./*.doc.ts", {
  eager: true,
  import: "default",
});

const orderedModulePaths = [
  "./auth-center-client-management.doc.ts",
  "./oauth-app-review-management.doc.ts",
  "./auth-center-client-review-management.doc.ts",
  "./user-management.doc.ts",
  "./group-management.doc.ts",
  "./permission-management.doc.ts",
  "./balance-management.doc.ts",
  "./monthly-pass-management.doc.ts",
  "./redemption-code-management.doc.ts",
  "./json-endpoint-management.doc.ts",
  "./article-management.doc.ts",
  "./legal-policy-management.doc.ts",
  "./feedback-management.doc.ts",
] as const;

export const registerAdminDocs = (registry: DocsRegistryBuilder) => {
  orderedModulePaths.forEach((modulePath) => {
    const page = modules[modulePath];
    if (!page) {
      throw new Error(`Missing docs module: ${modulePath}`);
    }
    registry.registerPage(page);
  });
};
