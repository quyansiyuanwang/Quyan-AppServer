import {
  UserScriptExecutionRepository,
  type UserScriptExecutionTarget,
} from "@/store/user-script-execution.repository";
import { UserScriptRepository } from "@/store/user-script.repository";
import { UserScriptIamService } from "./user-script-iam.service";
import { SCRIPT_EXECUTION_LIMITS } from "./execution-limits";
import { IamAuthorizationService } from "@/iam/iam-authorization.service";
import { userScriptArn, userScriptExecutionArn, isCanonicalScriptId } from "@/iam/resources/script-resources";
import { iamAuthenticatedUserResourceResolver } from "@/iam/request/resource-resolvers";
import type { TypedRequest } from "@/types/express";
import { ForbiddenError } from "@/util/errors";

const denied = () =>
  new ForbiddenError("Script history authorization unavailable", undefined, {
    messageKey: "permission.insufficientPermission",
  });
const targetResources = (owner: string, target: UserScriptExecutionTarget) => [
  userScriptExecutionArn(owner, target.userId, target.id),
  ...(target.scriptId ? [userScriptArn(owner, target.userId, target.scriptId)] : []),
];

export class UserScriptExecutionIamService {
  private static instance: UserScriptExecutionIamService;
  private constructor(
    private readonly repository = UserScriptExecutionRepository.getInstance(),
    private readonly scripts = UserScriptRepository.getInstance(),
    private readonly scriptIam = UserScriptIamService.getInstance(),
    private readonly iam = IamAuthorizationService.getInstance(),
  ) {}
  static getInstance() {
    return (this.instance ??= new UserScriptExecutionIamService());
  }

  public async authorizeSave(userId: string, scriptId: string | undefined, request?: TypedRequest) {
    const identity = this.scriptIam.identity(userId, request);
    const resource = await iamAuthenticatedUserResourceResolver(identity);
    if (typeof resource !== "string") throw denied();
    if (scriptId !== undefined && !isCanonicalScriptId(scriptId)) throw denied();
    const target =
      scriptId === undefined
        ? undefined
        : await this.scripts.findTarget(scriptId, userId, identity.principal.accountOwnerId);
    if (scriptId !== undefined && (!target || target.id !== scriptId || target.userId !== userId)) throw denied();
    const resources = [
      resource,
      ...(target ? [userScriptArn(identity.principal.accountOwnerId, userId, target.id)] : []),
    ];
    if (
      (await this.scriptIam.filter(identity.request, identity.principal, "quyan:script:SaveExecution", resources))
        .length !== resources.length
    )
      throw denied();
    return { principal: identity.principal, target: target ?? undefined };
  }

  public async list(userId: string, request?: TypedRequest, scriptId?: string) {
    const { request: trusted, principal } = this.scriptIam.identity(userId, request);
    await this.iam.loadPolicies(principal);
    if (scriptId !== undefined)
      await this.scriptIam.authorizeTarget(scriptId, userId, "quyan:script:ListExecutions", trusted);
    let after: UserScriptExecutionTarget | undefined;
    const selected: UserScriptExecutionTarget[] = [];
    while (selected.length < SCRIPT_EXECUTION_LIMITS.responseRecords) {
      const targets = await this.repository.scanTargets(userId, principal.accountOwnerId, scriptId, after);
      if (!targets.length) break;
      if (
        targets.length > SCRIPT_EXECUTION_LIMITS.metadataBatch ||
        targets.some((target, index) => {
          const previous = index ? targets[index - 1] : after;
          return (
            target.userId !== userId ||
            !isCanonicalScriptId(target.id) ||
            (target.scriptId !== null && !isCanonicalScriptId(target.scriptId)) ||
            (scriptId !== undefined && target.scriptId !== scriptId) ||
            (previous &&
              (target.createTime > previous.createTime ||
                (target.createTime.getTime() === previous.createTime.getTime() && target.id >= previous.id)))
          );
        })
      )
        throw denied();
      const resources = [...new Set(targets.flatMap((target) => targetResources(principal.accountOwnerId, target)))];
      const allowed = new Set(
        await this.scriptIam.filter(trusted, principal, "quyan:script:ListExecutions", resources),
      );
      selected.push(
        ...targets
          .filter((target) =>
            targetResources(principal.accountOwnerId, target).every((resource) => allowed.has(resource)),
          )
          .slice(0, SCRIPT_EXECUTION_LIMITS.responseRecords - selected.length),
      );
      after = targets[targets.length - 1];
      if (targets.length < SCRIPT_EXECUTION_LIMITS.metadataBatch) break;
    }
    const resources = [...new Set(selected.flatMap((target) => targetResources(principal.accountOwnerId, target)))];
    if (
      (await this.scriptIam.filter(trusted, principal, "quyan:script:ListExecutions", resources)).length !==
      resources.length
    )
      throw denied();
    const rows = await this.repository.readTargets(userId, principal.accountOwnerId, selected);
    const snapshots = new Map(selected.map((target) => [target.id, target]));
    if (
      rows.length !== selected.length ||
      new Set(rows.map((row) => row.id)).size !== selected.length ||
      rows.some((row) => {
        const target = snapshots.get(row.id);
        return (
          !target ||
          row.userId !== userId ||
          row.scriptId !== target.scriptId ||
          row.createTime.getTime() !== target.createTime.getTime()
        );
      })
    )
      throw denied();
    // A grant revoked while snapshots were loaded must not be returned as an authorized history.
    if (
      (await this.scriptIam.filter(trusted, principal, "quyan:script:ListExecutions", resources)).length !==
      resources.length
    )
      throw denied();
    if (scriptId !== undefined)
      await this.scriptIam.authorizeTarget(scriptId, userId, "quyan:script:ListExecutions", trusted);
    await this.iam.loadPolicies(principal);
    return rows;
  }
}
