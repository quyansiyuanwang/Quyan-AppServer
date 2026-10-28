import { Permission } from "@quyan/shared";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { getIamPrincipal } from "@/iam/request/principal-context";
import { isPlatformUserId, platformUserArn } from "@/iam/resources/platform-user-resources";
import { PlatformResourceReadIamService } from "@/services/system/platform-resource-read-iam.service";
import { PlatformManagementReadRepository } from "@/store/system/platform-management-read.repository";
import type { PlatformManagementReadStore } from "@/store/system/platform-management-read.store";
import { PlatformUserDeleteRepository } from "@/store/users/platform-user-delete.repository";
import type { PlatformUserDeleteStore, PlatformUserDeleteGuard } from "@/store/users/platform-user-delete.store";
import { iamAccountDenied } from "@/store/users/iam-account-principal";
import type { TypedRequest } from "@/types/express";
const action = "quyan:user:DeleteUser",
  permission = Permission.USER_DELETE;
export class PlatformUserDeleteIamService {
  private static instance: PlatformUserDeleteIamService;
  constructor(
    private readonly iam: Pick<
      IamAuthorizationService,
      "loadPolicies" | "authorizeMany"
    > = IamAuthorizationService.getInstance(),
    private readonly snapshots: PlatformManagementReadStore = PlatformManagementReadRepository.getInstance(),
    private readonly repository: PlatformUserDeleteStore = PlatformUserDeleteRepository.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new PlatformUserDeleteIamService());
  }
  async execute(id: string, actorId: string, request?: TypedRequest, persist = true) {
    const principal = request && getIamPrincipal(request);
    if (
      !request ||
      !principal ||
      !isPlatformUserId(id) ||
      principal.subjectUserId !== actorId ||
      principal.principalUserId !== actorId ||
      id === actorId ||
      id === principal.accountOwnerId ||
      request.oauthAccessToken
    )
      throw iamAccountDenied();
    const identity = { ...principal },
      target = await this.repository.target(identity, id);
    if (target.resource.id !== id) throw iamAccountDenied();
    const prepared = await new PlatformResourceReadIamService(this.iam, this.snapshots).read(
      action,
      identity,
      request,
      platformUserArn(id),
      async (guard) => {
        const snapshot = await this.snapshots.snapshot(identity, permission),
          authorizationRevision = await this.repository.authorizationRevision(identity);
        const write: PlatformUserDeleteGuard = {
          action,
          target,
          group: snapshot.group,
          authorizationRevision,
          users: {
            principal: identity,
            targetUserId: actorId,
            users: snapshot.users,
            recheck: async () => {
              await guard.recheck();
              await this.snapshots.recheck(identity, permission, snapshot);
              if ((await this.repository.authorizationRevision(identity)) !== authorizationRevision)
                throw iamAccountDenied();
            },
          },
        };
        if (!persist) guard.trackSource(() => this.repository.recheck(identity, target));
        return write;
      },
    );
    if (!persist) return undefined;
    return this.repository.remove(prepared);
  }
}
