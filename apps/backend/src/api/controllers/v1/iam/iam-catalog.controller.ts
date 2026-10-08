import { getIamPolicyJsonSchema } from "@/iam/diagnostics/policy-json-schema";
import { Controller, Get, Path, Query, Route, Security, Tags } from "@tsoa/runtime";
import type {
  IamActionDefinition,
  IamConditionKeyDefinition,
  IamResourceTypeDefinition,
  IamServiceDefinition,
} from "@quyan/shared";
import { Permission } from "@quyan/shared";
import { IamCatalogService } from "@/iam/iam-catalog.service";
import { CheckPermission, PermissionCheckMode } from "@/util/permission/permission-decorator";
import { ramAccountResourceResolver } from "@/iam/request/resource-resolvers";
@Route("v1/iam/catalog")
@Tags("IAM Catalog")
export class IamCatalogController extends Controller {
  @Get("services")
  @Security("jwt")
  @CheckPermission(Permission.RAM_POLICY_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:ReadPolicy",
    resourceKind: "account",
    resource: ramAccountResourceResolver,
  })
  public async listServices(): Promise<IamServiceDefinition[]> {
    return IamCatalogService.getInstance().listServices();
  }
  @Get("services/{service}/actions")
  @Security("jwt")
  @CheckPermission(Permission.RAM_POLICY_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:ReadPolicy",
    resourceKind: "account",
    resource: ramAccountResourceResolver,
  })
  public async listActions(@Path() service: string): Promise<IamActionDefinition[]> {
    return IamCatalogService.getInstance().listActions(service);
  }
  @Get("resources")
  @Security("jwt")
  @CheckPermission(Permission.RAM_POLICY_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:ReadPolicy",
    resourceKind: "account",
    resource: ramAccountResourceResolver,
  })
  public async listResources(): Promise<IamResourceTypeDefinition[]> {
    return IamCatalogService.getInstance().listResources();
  }
  @Get("policy-schema")
  @Security("jwt")
  @CheckPermission(Permission.RAM_POLICY_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:ReadPolicy",
    resourceKind: "account",
    resource: ramAccountResourceResolver,
  })
  public async getPolicySchema(
    @Query() policyKind: "identity" | "trust" = "identity",
  ): Promise<Record<string, unknown>> {
    return getIamPolicyJsonSchema(policyKind);
  }
  @Get("condition-keys")
  @Security("jwt")
  @CheckPermission(Permission.RAM_POLICY_READ, PermissionCheckMode.ALL, "jwt", {
    action: "quyan:ram:ReadPolicy",
    resourceKind: "account",
    resource: ramAccountResourceResolver,
  })
  public async listConditionKeys(): Promise<IamConditionKeyDefinition[]> {
    return IamCatalogService.getInstance().listConditionKeys();
  }
}
