import { fileURLToPath } from "node:url";
import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";

const backendRoot = fileURLToPath(new URL("../../../", import.meta.url));
const project = new Project({ skipAddingFilesFromTsConfig: true });
const files = [
  "src/api/controllers/v1/auth/auth.controller.ts",
  "src/api/controllers/v1/oauth/oauth.controller.ts",
  "src/api/controllers/v1/auth-center/auth-center.controller.ts",
];
const routes = collectIamRoutes(project.addSourceFilesAtPaths(files.map((path) => backendRoot + path)), backendRoot);

const expectedActions = [
  ["GET /v1/auth/external/identities", "quyan:auth:ListExternalIdentities"],
  ["POST /v1/auth/external/bind", "quyan:auth:BindExternalIdentity"],
  ["POST /v1/auth/external/unbind", "quyan:auth:UnbindExternalIdentity"],
  ["POST /v1/auth/central-login/secure-flows", "quyan:auth:CreateCentralLoginFlow"],
  ["POST /v1/auth/central-login/flows/consume", "quyan:auth:ConsumeCentralLoginFlow"],
  ["POST /v1/auth/qr-login/scan", "quyan:auth:ScanQrLogin"],
  ["POST /v1/auth/qr-login/confirm", "quyan:auth:ConfirmQrLogin"],
  ["GET /v1/oauth/scopes", "quyan:oauth:ListScopes"],
  ["GET /v1/oauth/authorize", "quyan:oauth:GetAuthorizationPreview"],
  ["POST /v1/oauth/authorize", "quyan:oauth:DecideAuthorization"],
  ["GET /v1/auth-center/authorize", "quyan:auth_center:GetAuthorizationPreview"],
  ["POST /v1/auth-center/authorize", "quyan:auth_center:DecideAuthorization"],
];

describe("authenticated flow IAM route metadata", () => {
  it.each(expectedActions)("declares fixed subject-scoped Action for %s", (key, action) => {
    expect(routes.find((route) => route.key === key)).toMatchObject({
      security: ["jwt"],
      coverage: "explicit",
      actions: [action],
      resourceKind: "single-resource",
      resolver: "iamAuthenticatedUserResourceResolver",
      issues: [],
    });
  });

  it.each([
    "POST /v1/auth/login",
    "POST /v1/auth/refresh",
    "POST /v1/auth/qr-login/session",
    "POST /v1/auth/qr-login/consume",
    "POST /v1/oauth/token",
    "POST /v1/oauth/revoke",
    "POST /v1/auth-center/token",
    "POST /v1/auth-center/revoke",
    "GET /v1/auth-center/.well-known/jwks.json",
    "GET /v1/auth-center/.well-known/openid-configuration",
  ])("does not impose JWT IAM on public protocol endpoint %s", (key) => {
    expect(routes.find((route) => route.key === key)).toMatchObject({
      security: [],
      coverage: "public",
      actions: [],
      issues: [],
    });
  });
});
