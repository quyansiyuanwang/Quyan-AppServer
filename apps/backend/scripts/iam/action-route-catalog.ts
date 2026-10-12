import { getIamActionDefinition } from "@quyan/shared";
import type { IamRouteEntry } from "./route-inventory";
/** Derive route links from the Controller audit; never maintain a second path registry. */
export function actionRouteCatalog(routes: readonly IamRouteEntry[]): Record<string, string[]> {
  const result = new Map<string, Set<string>>();
  for (const route of routes) {
    if (route.issues.length || !["explicit", "legacy"].includes(route.coverage)) continue;
    for (const action of new Set(
      route.actions.flatMap((action) => [action, ...(getIamActionDefinition(action)?.conditionalActions ?? [])]),
    )) {
      const paths = result.get(action) ?? new Set<string>();
      paths.add(route.key);
      result.set(action, paths);
    }
  }
  return Object.fromEntries(
    [...result].sort(([a], [b]) => a.localeCompare(b)).map(([action, paths]) => [action, [...paths].sort()]),
  );
}
