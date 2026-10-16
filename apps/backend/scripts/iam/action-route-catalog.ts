import { getIamActionDefinition } from "@quyan/shared";
import type { IamRouteEntry } from "./route-inventory";
/** Derive route links from the Controller audit; never maintain a second path registry. */
export function actionRouteCatalog(routes: readonly IamRouteEntry[]): Record<string, string[]> {
  const result = new Map<string, Set<string>>();
  for (const route of routes) {
    if (route.issues.length || !["explicit", "legacy"].includes(route.coverage)) continue;
    // Traverse dependencies for discovery only. Cycles (source <-> destination) never add runtime grants.
    const actions = new Set<string>(),
      pending = [...route.actions];
    while (pending.length) {
      const action = pending.pop()!;
      if (actions.has(action)) continue;
      actions.add(action);
      const definition = getIamActionDefinition(action);
      pending.push(
        ...(definition?.conditionalActions ?? []),
        ...(definition?.resourceDependencies?.map((dependency) => dependency.action) ?? []),
      );
    }
    for (const action of actions) {
      const paths = result.get(action) ?? new Set<string>();
      paths.add(route.key);
      result.set(action, paths);
    }
  }
  return Object.fromEntries(
    [...result].sort(([a], [b]) => a.localeCompare(b)).map(([action, paths]) => [action, [...paths].sort()]),
  );
}
