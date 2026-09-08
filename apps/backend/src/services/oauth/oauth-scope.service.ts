import {
  getOAuthScopeCatalog,
  getOAuthScopeDefinition,
  isOAuthScopeGrantable,
  type OAuthScopeDefinition,
} from "@quyan/shared";
import { permissionService } from "@/services/users/permission.service";
import { BadRequestError, ForbiddenError } from "@/util/errors";

export interface OAuthScopeCatalogItem {
  scope: string;
  kind: OAuthScopeDefinition["kind"];
  category: string;
  riskLevel: OAuthScopeDefinition["riskLevel"];
  legacy: boolean;
  labelKey: string;
  descriptionKey: string;
  categoryKey: string;
  grantable: boolean;
}

export class OAuthScopeService {
  private static instance: OAuthScopeService;

  static getInstance(): OAuthScopeService {
    if (!this.instance) this.instance = new OAuthScopeService();
    return this.instance;
  }

  async listForUser(userId: string): Promise<OAuthScopeCatalogItem[]> {
    const permissions = await permissionService.getUserFullPermissions(userId);
    const effectivePermissions = permissions?.effectivePermissions ?? [];
    return getOAuthScopeCatalog().map((definition) => ({
      scope: definition.scope,
      kind: definition.kind,
      category: definition.category,
      riskLevel: definition.riskLevel,
      legacy: definition.legacy,
      labelKey: definition.labelKey,
      descriptionKey: definition.descriptionKey,
      categoryKey: definition.categoryKey,
      isNew: false,
      grantable: isOAuthScopeGrantable(definition, effectivePermissions),
    }));
  }

  async normalizeAndAssertGrantable(userId: string, scopes: string[]): Promise<string[]> {
    const normalized = [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))];
    const definitions = normalized.map((scope) => getOAuthScopeDefinition(scope));
    const unknown = normalized.filter((_, index) => !definitions[index]);
    if (unknown.length > 0)
      throw new BadRequestError(`未知的 OAuth scope: ${unknown.join(", ")}`, undefined, {
        messageKey: "oauth.unknownScope",
        messageParams: { scopes: unknown.join(", ") },
      });

    const permissions = await permissionService.getUserFullPermissions(userId);
    const effectivePermissions = permissions?.effectivePermissions ?? [];
    const forbidden = normalized.filter((_, index) => {
      const definition = definitions[index];
      return definition ? !isOAuthScopeGrantable(definition, effectivePermissions) : false;
    });
    if (forbidden.length > 0)
      throw new ForbiddenError(`不能授予当前用户未拥有的 OAuth scope: ${forbidden.join(", ")}`, undefined, {
        messageKey: "oauth.ungrantableScope",
        messageParams: { scopes: forbidden.join(", ") },
      });

    return normalized;
  }

  async buildAuthorizationDetails(userId: string, requestedScopes: string[], previouslyGrantedScopes: string[]) {
    const catalog = await this.listForUser(userId);
    const byScope = new Map(catalog.map((item) => [item.scope, item]));
    const unavailableScopes: string[] = [];
    const scopeDetails = requestedScopes.map((scope) => {
      const item = byScope.get(scope);
      if (!item) {
        unavailableScopes.push(scope);
        return {
          scope,
          category: "unknown",
          riskLevel: "high" as const,
          labelKey: "oauthScopes.unknown.label",
          descriptionKey: "oauthScopes.unknown.description",
          isNew: !previouslyGrantedScopes.includes(scope),
          grantable: false,
        };
      }
      // Legacy scopes use their catalog permission mapping, so revoking the
      // canonical permission also makes the old scope unavailable.
      const grantable = item.grantable;
      if (!grantable) unavailableScopes.push(scope);
      return {
        scope: item.scope,
        category: item.category,
        riskLevel: item.riskLevel,
        labelKey: item.labelKey,
        descriptionKey: item.descriptionKey,
        isNew: !previouslyGrantedScopes.includes(scope),
        grantable,
      };
    });
    return { scopeDetails, unavailableScopes };
  }
}

export const oauthScopeService = OAuthScopeService.getInstance();
