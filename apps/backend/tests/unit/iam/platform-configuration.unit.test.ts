import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/iam/audit/iam-audit.service", () => ({ auditIamDecision: vi.fn() }));
vi.mock("@/store/system/platform-configuration.repository", () => ({
  PlatformConfigurationRepository: { getInstance: vi.fn() },
}));
vi.mock("@/store/users/iam-account-principal", async () => {
  const { ForbiddenError } = await import("@/util/errors");
  return {
    IamAccountUserRepository: { getInstance: vi.fn() },
    iamAccountDenied: () =>
      new ForbiddenError("fixture unavailable", undefined, { messageKey: "permission.insufficientPermission" }),
  };
});
import { PlatformConfigurationIamService } from "@/services/system/platform-configuration-iam.service";
import { platformConfigurationArn } from "@/iam/resources/platform-configuration-resources";
import {
  platformConfigurationBatchResolver,
  registrationConfigurationResources,
  smtpConfigurationResources,
  siteConfigurationResources,
  relayConfigurationResources,
  relayProxyConfigurationResources,
  autoProxyPoolConfigurationResources,
  ipBanConfigurationResources,
  captchaConfigurationResources,
  socialAuthConfigurationResources,
  notificationConfigurationResources,
  billingConfigurationResources,
  heartbeatConfigurationResources,
  remoteTerminalUnbindConfigurationResources,
} from "@/iam/request/platform-configuration-resource-resolvers";
import { CONFIG_KEYS } from "@/constant/config-keys";
import {
  RELAY_CONFIGURATION_KEYS,
  RELAY_PROXY_CONFIGURATION_KEYS,
  AUTO_PROXY_POOL_CONFIGURATION_KEYS,
  IP_BAN_CONFIGURATION_KEYS,
  CAPTCHA_CONFIGURATION_KEYS,
  SOCIAL_AUTH_CONFIGURATION_KEYS,
} from "@/constant/config-keysets";
import { Permission, SERVER_CONFIG_SECRET_PLACEHOLDER } from "@quyan/shared";
import { Project } from "ts-morph";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import type { TypedRequest } from "@/types/express";
const allow = { decision: "Allow", reason: "matched-allow", matchedStatements: [] },
  deny = { ...allow, decision: "ExplicitDeny" };
const target = (key: string) => ({ id: key.replaceAll(".", "-"), key, status: 1, updateTime: new Date(0) });
let service: PlatformConfigurationIamService, iam: any, repo: any, request: TypedRequest;
beforeEach(() => {
  iam = {
    loadPolicies: vi.fn().mockResolvedValue([]),
    authorizeMany: vi.fn().mockImplementation(async ({ resources }: any) => resources.map(() => allow)),
    authorize: vi.fn().mockResolvedValue(allow),
  };
  repo = {
    groupSnapshot: vi.fn().mockResolvedValue({ id: "global", updateTime: new Date(0) }),
    scan: vi.fn().mockResolvedValue([target(CONFIG_KEYS.SMTP.PASSWORD)]),
    targets: vi.fn().mockResolvedValue([]),
    hydrate: vi
      .fn()
      .mockImplementation(async (_: any, targets: any[]) => targets.map((t) => ({ ...t, value: "fixture-secret" }))),
    recheck: vi.fn().mockImplementation(async (guard: any) => guard.users.recheck()),
    update: vi.fn(),
  };
  service = new (PlatformConfigurationIamService as unknown as new (...args: any[]) => PlatformConfigurationIamService)(
    iam,
    repo,
    {
      targets: vi
        .fn()
        .mockImplementation(async (_: any, ids: string[]) => ids.map((id) => ({ id, updateTime: new Date(0) }))),
    },
  );
  request = {
    user: { userId: "actor" },
    authContext: { principalUserId: "actor", accountOwnerId: "owner" },
    headers: { "x-action": "*" },
    body: { configs: { [CONFIG_KEYS.SMTP.HOST]: "fixture" }, accountId: "foreign" },
  } as unknown as TypedRequest;
});
describe("platform configuration IAM", () => {
  it("uses fixed actions and a resource for each registered server configuration key", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/system/config.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    expect(routes.find((r) => r.key === "GET /v1/config")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:system:ListConfigurations"],
      issues: [],
    });
    expect(routes.find((r) => r.key === "PUT /v1/config")).toMatchObject({
      coverage: "explicit",
      actions: ["quyan:system:UpdateConfigurations"],
      issues: [],
    });
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    expect(await platformConfigurationBatchResolver({ request, principal })).toEqual([
      "acs:platform:*:platform:config-item/smtp.host",
    ]);
    expect(() => platformConfigurationArn("unregistered")).toThrow();
    request.body = { configs: { unregistered: "value" } } as any;
    expect(await platformConfigurationBatchResolver({ request, principal })).toBeUndefined();
  });
  it("filters Deny before reading values and masks secrets in the returned view", async () => {
    expect((await service.list(request)).configs[CONFIG_KEYS.SMTP.PASSWORD]).toBe(SERVER_CONFIG_SECRET_PLACEHOLDER);
    repo.hydrate.mockClear();
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map((r: string) => (r.endsWith("/smtp.password") ? deny : allow)),
    );
    expect((await service.list(request)).configs).toEqual({});
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
  it("requires every write target and does not snapshot denied configurations", async () => {
    iam.authorizeMany.mockResolvedValue([allow, deny]);
    await expect(
      service.prepareUpdate([CONFIG_KEYS.SMTP.HOST, CONFIG_KEYS.SMTP.PASSWORD], "actor", request),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.targets).not.toHaveBeenCalled();
  });
  it("cannot bypass support-resource Deny through the generic configuration route", async () => {
    iam.authorize.mockResolvedValue(deny);
    await expect(service.prepareUpdate([CONFIG_KEYS.SUPPORT_AI.MODEL], "actor", request)).rejects.toMatchObject({
      statusCode: 403,
    });
    repo.scan.mockResolvedValue([target(CONFIG_KEYS.SUPPORT_AI.MODEL)]);
    expect((await service.list(request)).configs).toEqual({});
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
  it("rejects missing identities, unknown keys, revoked final grants and OAuth tokens", async () => {
    await expect(service.list()).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.prepareUpdate(["unregistered"], "actor", request)).rejects.toMatchObject({ statusCode: 403 });
    const guard = await service.prepareUpdate([CONFIG_KEYS.SMTP.HOST], "actor", request);
    iam.authorizeMany.mockResolvedValue([deny]);
    await expect(guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
    request.oauthAccessToken = { id: "token" } as any;
    await expect(service.list(request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("shadow diagnostics never load display fields or stored secrets", async () => {
    await service.list(request, false);
    expect(repo.hydrate).not.toHaveBeenCalled();
  });
  it("rejects grants revoked while display fields were being loaded", async () => {
    repo.hydrate.mockImplementation(async (_: any, targets: any[]) => {
      iam.authorizeMany.mockResolvedValue([deny]);
      return targets.map((t) => ({ ...t, value: "fixture-value" }));
    });
    await expect(service.list(request)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("declares both operations for configuration sections with fixed resource sets", async () => {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath("src/api/controllers/v1/system/config.controller.ts");
    const routes = collectIamRoutes(project.getSourceFiles(), process.cwd());
    const principal = {
      subjectUserId: "actor",
      principalUserId: "actor",
      accountOwnerId: "owner",
      subjectType: "sub_user" as const,
    };
    for (const [path, keys, resolver] of [
      ["registration", Object.values(CONFIG_KEYS.REGISTRATION), registrationConfigurationResources],
      ["smtp", Object.values(CONFIG_KEYS.SMTP), smtpConfigurationResources],
      ["site", Object.values(CONFIG_KEYS.SITE), siteConfigurationResources],
      ["ipban", IP_BAN_CONFIGURATION_KEYS, ipBanConfigurationResources],
      ["captcha", CAPTCHA_CONFIGURATION_KEYS, captchaConfigurationResources],
      ["social-auth", SOCIAL_AUTH_CONFIGURATION_KEYS, socialAuthConfigurationResources],
      ["relay", RELAY_CONFIGURATION_KEYS, relayConfigurationResources],
      ["relay/proxy", RELAY_PROXY_CONFIGURATION_KEYS, relayProxyConfigurationResources],
      ["auto-proxy-pool", AUTO_PROXY_POOL_CONFIGURATION_KEYS, autoProxyPoolConfigurationResources],
      ["notification", Object.values(CONFIG_KEYS.NOTIFICATION), notificationConfigurationResources],
      ["billing", Object.values(CONFIG_KEYS.BILLING), billingConfigurationResources],
      ["heartbeat", Object.values(CONFIG_KEYS.HEARTBEAT), heartbeatConfigurationResources],
      [
        "remote-terminal/unbind",
        Object.values(CONFIG_KEYS.REMOTE_TERMINAL),
        remoteTerminalUnbindConfigurationResources,
      ],
    ] as const) {
      for (const [verb, action] of [
        ["GET", "quyan:system:ListConfigurations"],
        ["PUT", "quyan:system:UpdateConfigurations"],
      ])
        expect(routes.find((r) => r.key === verb + " /v1/config/" + path)).toMatchObject({
          coverage: "explicit",
          actions: [action],
          issues: [],
        });
      expect(await resolver({ request, principal })).toEqual([...keys].sort().map(platformConfigurationArn));
    }
    for (const path of ["registration", "captcha", "social-auth"])
      expect(routes.find((r) => r.key === "GET /v1/config/public/" + path)?.security).toEqual([]);
    expect(
      routes.filter((r) => r.security.includes("jwt")).every((r) => r.coverage === "explicit" && r.issues.length === 0),
    ).toBe(true);
  });
  it("requires the complete registered key set before a typed configuration read", async () => {
    const guard = await service.prepareRead(Object.values(CONFIG_KEYS.SITE), request);
    expect(guard.action).toBe("quyan:system:ListConfigurations");
    iam.authorizeMany.mockImplementation(async ({ resources }: any) =>
      resources.map((r: string) => (r.endsWith("/smtp.password") ? deny : allow)),
    );
    await expect(service.prepareRead(Object.values(CONFIG_KEYS.SMTP), request)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

it("masks credentials embedded in proxy URLs without exposing stored values", async () => {
  repo.scan.mockResolvedValue([target(CONFIG_KEYS.RELAY.UPSTREAM_PROXY_URL)]);
  repo.hydrate.mockImplementation(async (_: unknown, targets: any[]) =>
    targets.map((t) => ({ ...t, value: "http://fixture-user:fixture-password@proxy.example.test:3128" })),
  );
  expect((await service.list(request)).configs[CONFIG_KEYS.RELAY.UPSTREAM_PROXY_URL]).toBe(
    SERVER_CONFIG_SECRET_PLACEHOLDER,
  );
});

describe("ticket rules through general configuration", () => {
  it("filters ticket rule secrets/values before general configuration hydration on a domain Deny", async () => {
    // The source must keep key order as required by the production metadata scanner.
    repo.scan.mockResolvedValue(
      [target(CONFIG_KEYS.NOTIFICATION.TICKET_ASSIGNMENT_RULES), target(CONFIG_KEYS.SMTP.HOST)].sort((a, b) =>
        a.key.localeCompare(b.key),
      ),
    );
    iam.authorize.mockImplementation(async ({ action }: any) =>
      action === "quyan:ticket:GetAssignmentRules" ? deny : allow,
    );
    const result = await service.list(request);
    expect(result.configs).not.toHaveProperty(CONFIG_KEYS.NOTIFICATION.TICKET_ASSIGNMENT_RULES);
    expect(
      repo.hydrate.mock.calls
        .flatMap((call: any) => call[1])
        .some((row: any) => row.key === CONFIG_KEYS.NOTIFICATION.TICKET_ASSIGNMENT_RULES),
    ).toBe(false);
  });
  it("does not infer ticket rule management eligibility from general configuration permission", async () => {
    const { ForbiddenError } = await import("@/util/errors");
    repo.groupSnapshot.mockImplementation(async (_p: any, permission: any) => {
      if (permission === Permission.TICKET_REVIEW_UPDATE)
        throw new ForbiddenError("fixture", undefined, { messageKey: "permission.insufficientPermission" });
      return { id: "global", updateTime: new Date(0) };
    });
    await expect(
      service.prepareUpdate([CONFIG_KEYS.NOTIFICATION.TICKET_ASSIGNMENT_RULES], "actor", request),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.update).not.toHaveBeenCalled();
  });
  it("checks the dedicated write Action for the same configuration ARN", async () => {
    iam.authorize.mockImplementation(async ({ action }: any) =>
      action === "quyan:ticket:UpdateAssignmentRules" ? deny : allow,
    );
    await expect(
      service.prepareUpdate([CONFIG_KEYS.NOTIFICATION.TICKET_ASSIGNMENT_RULES], "actor", request),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(iam.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "quyan:ticket:UpdateAssignmentRules",
        resource: platformConfigurationArn(CONFIG_KEYS.NOTIFICATION.TICKET_ASSIGNMENT_RULES),
      }),
    );
  });
  it("rechecks the domain Action when committing general configuration writes", async () => {
    const guard = await service.prepareUpdate([CONFIG_KEYS.NOTIFICATION.TICKET_ASSIGNMENT_RULES], "actor", request);
    iam.authorize.mockResolvedValue(deny);
    await expect(guard.users.recheck()).rejects.toMatchObject({ statusCode: 403 });
  });
});
