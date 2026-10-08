import {
  IAM_ACTION_DEFINITIONS,
  IAM_CONDITION_KEY_CATALOG,
  IAM_RESOURCE_TYPE_CATALOG,
  iamServiceDefinitions,
} from "@quyan/shared";
import type {
  IamActionDefinition,
  IamResourceTypeDefinition,
  IamConditionKeyDefinition,
  IamServiceDefinition,
} from "@quyan/shared";
import { IAM_ACTION_ROUTES } from "@/build/iam-action-routes";
import { NotFoundError } from "@/util/errors";
export class IamCatalogService {
  private static instance: IamCatalogService;
  static getInstance(): IamCatalogService {
    return (this.instance ??= new IamCatalogService());
  }
  listServices(): IamServiceDefinition[] {
    return iamServiceDefinitions(
      IAM_ACTION_DEFINITIONS.filter((action) => IAM_ACTION_ROUTES[action.action]?.length).map((action) => ({
        ...action,
        resourceTypes: [...action.resourceTypes],
        conditionKeys: [...action.conditionKeys],
        apiRoutes: [...IAM_ACTION_ROUTES[action.action]],
      })),
    );
  }
  listActions(service: string): IamActionDefinition[] {
    const entry = this.listServices().find((entry) => entry.code === service);
    if (!entry) throw new NotFoundError("Unknown IAM service", undefined, { messageKey: "iam.unknownService" });
    return entry.actions;
  }
  listConditionKeys(): IamConditionKeyDefinition[] {
    return IAM_CONDITION_KEY_CATALOG.map((key) => ({ ...key, operators: [...key.operators] }));
  }
  listResources(): IamResourceTypeDefinition[] {
    return IAM_RESOURCE_TYPE_CATALOG.map((resource) => ({ ...resource }));
  }
}
