import type { DocsRegistryBuilder, DocsPageModule } from "@/docs/types";

const modules = import.meta.glob<DocsPageModule>("./*.doc.ts", {
  eager: true,
  import: "default",
});

const orderedModulePaths = [
  "./server-configuration.doc.ts",
  "./ip-monitoring-dashboard.doc.ts",
  "./system-statistics.doc.ts",
  "./user-online-monitor.doc.ts",
  "./consumption-statistics.doc.ts",
  "./system-logs.doc.ts",
  "./business-logs.doc.ts",
] as const;

export const registerSystemDocs = (registry: DocsRegistryBuilder) => {
  orderedModulePaths.forEach((modulePath) => {
    const page = modules[modulePath];
    if (!page) {
      throw new Error(`Missing docs module: ${modulePath}`);
    }
    registry.registerPage(page);
  });
};
