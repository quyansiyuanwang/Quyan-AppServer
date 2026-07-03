import type { DocsRegistryBuilder, DocsPageModule } from "@/docs/types";

const modules = import.meta.glob<DocsPageModule>("./*.doc.ts", {
  eager: true,
  import: "default",
});

const orderedModulePaths = [
  "./account-settings.doc.ts",
  "./access-key-management.doc.ts",
  "./oauth-app-management.doc.ts",
  "./auth-center-app-management.doc.ts",
  "./notification-settings.doc.ts",
  "./balance-history.doc.ts",
  "./my-monthly-passes.doc.ts",
] as const;

export const registerAccountDocs = (registry: DocsRegistryBuilder) => {
  orderedModulePaths.forEach((modulePath) => {
    const page = modules[modulePath];
    if (!page) {
      throw new Error(`Missing docs module: ${modulePath}`);
    }
    registry.registerPage(page);
  });
};
