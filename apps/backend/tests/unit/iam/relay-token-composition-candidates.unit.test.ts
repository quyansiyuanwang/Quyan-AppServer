import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/database", () => ({ prisma: {} }));
vi.mock("@/iam/iam-authorization.service", () => ({ IamAuthorizationService: { getInstance: vi.fn() } }));
vi.mock("@/services/users/permission.service", () => ({ PermissionService: { getInstance: vi.fn() } }));
import { Project } from "ts-morph";
import { getIamActionDefinition, Permission } from "@quyan/shared";
import { collectIamRoutes } from "../../../scripts/iam/route-inventory";
import {
  projectRelayCompositionCandidates,
  RelayTokenCompositionReadService,
} from "@/services/relay/relay-token-composition-read.service";
import type { RelayTokenCompositionReadNode } from "@/store/relay/relay-token-composition-read.repository";
const node = (
  id: string,
  members: string[] = [],
  routingMode = members.length ? "composite" : "ordered",
): RelayTokenCompositionReadNode => ({
  id,
  userId: "actor",
  status: 1,
  createTime: new Date(0),
  updateTime: new Date(0),
  expiresAt: null,
  routingMode,
  memberTokenConfigs: members.map((tokenId, priority) => ({
    id: "edge-" + id + "-" + tokenId,
    status: 1,
    updateTime: new Date(0),
    tokenId,
    priority,
    enabled: true,
  })),
});
const target = (row: RelayTokenCompositionReadNode) => ({
  id: row.id,
  userId: row.userId,
  status: row.status,
  updateTime: row.updateTime,
  name: row.id,
});
const query = { page: 1, pageSize: 100, search: "" };
const project = (
  graph: RelayTokenCompositionReadNode[],
  allowed = graph.map((row) => row.id),
  overrides = {},
  selected: string[] = [],
) =>
  projectRelayCompositionCandidates(
    graph.filter((row) => allowed.includes(row.id)).map(target),
    graph,
    { ...query, ...overrides },
    selected,
  );
describe("complete-authorized candidate subtrees", () => {
  it("declares server-owned native candidate actions", () => {
    const p = new Project({ skipAddingFilesFromTsConfig: true });
    p.addSourceFileAtPath("src/api/controllers/v1/relay/relay.controller.ts");
    expect(
      collectIamRoutes(p.getSourceFiles(), process.cwd()).find(
        (row) => row.key === "GET /v1/relay/tokens/composition-candidates",
      ),
    ).toMatchObject({ coverage: "explicit", actions: ["quyan:relay:ListTokenCompositionCandidates"], issues: [] });
    expect(getIamActionDefinition("quyan:relay:ListManagedTokenCompositionCandidates")).toMatchObject({
      authorizationBoundary: "platform",
      legacyPermission: Permission.RELAY_TOKEN_MANAGE_OTHERS_READ,
    });
  });
  it("preserves full authorized member references and counts without exposing proofs", () => {
    const result = project([node("parent", ["child"]), node("child")]);
    expect(result.items.find((row) => row.id === "parent")).toMatchObject({
      memberCount: 1,
      memberTokenConfigs: [{ tokenId: "child", priority: 0, enabled: true }],
    });
    expect(JSON.stringify(result)).not.toMatch(/edge-parent|updateTime|userId/);
  });
  it("omits parents with any hidden descendant rather than exposing partial member counts", () => {
    const result = project([node("parent", ["middle"]), node("middle", ["leaf"]), node("leaf")], ["parent", "middle"]);
    expect(result).toMatchObject({ total: 0, items: [] });
  });
  it("also protects disabled references", () => {
    const parent = node("parent", ["child"]);
    parent.memberTokenConfigs[0]!.enabled = false;
    expect(project([parent, node("child")], ["parent"])).toMatchObject({ total: 0, items: [] });
  });
  it("does not cache shallow subtree validity at deeper positions", () => {
    const graph = [
      node("leaf"),
      node("n4", ["leaf"]),
      node("n3", ["n4"]),
      node("n2", ["n3"]),
      node("n1", ["n2"]),
      node("root", ["n1"]),
    ];
    const ids = project(graph).items.map((row) => row.id);
    expect(ids).toContain("n1");
    expect(ids).not.toContain("root");
  });
  it("bounds leaf paths even when many branches reuse the same leaves", () => {
    const leaves = Array.from({ length: 20 }, (_, i) => node("leaf" + i)),
      branches = Array.from({ length: 20 }, (_, i) =>
        node(
          "branch" + i,
          leaves.map((row) => row.id),
        ),
      ),
      root = node(
        "root",
        branches.map((row) => row.id),
      );
    expect(project([root, ...branches, ...leaves]).items.map((row) => row.id)).not.toContain("root");
  });
  it("omits cycles and missing, deleted, or cross-owner member subtrees", () => {
    const deleted = node("deleted");
    deleted.status = -1;
    const foreign = node("foreign");
    foreign.userId = "foreign";
    const graph = [
      node("a", ["b"]),
      node("b", ["a"]),
      node("missing-parent", ["missing"]),
      node("deleted-parent", ["deleted"]),
      deleted,
      node("foreign-parent", ["foreign"]),
      foreign,
    ];
    expect(project(graph, ["a", "b", "missing-parent", "deleted-parent", "foreign-parent"]).total).toBe(0);
  });
  it("marks self and fully authorized ancestors as unavailable without exposing hidden paths", () => {
    const result = project([node("parent", ["edit"]), node("edit"), node("other")], undefined, {
      editingTokenId: "edit",
    });
    expect(result.items.find((row) => row.id === "parent")).toMatchObject({
      selectable: false,
      unavailableReason: "cycle",
    });
    expect(result.items.find((row) => row.id === "edit")).toMatchObject({
      selectable: false,
      unavailableReason: "self",
    });
    expect(result.items.find((row) => row.id === "other")).toMatchObject({ selectable: true });
  });
  it("fails explicit selection and editing references closed rather than silently dropping them", () => {
    const graph = [node("parent", ["child"]), node("child")];
    expect(() => project(graph, ["parent"], {}, ["parent"])).toThrow();
    expect(() => project(graph, ["parent"], { editingTokenId: "child" })).toThrow();
  });
  it("filters search and pinned candidates before pagination and totals", () => {
    const result = project([node("alpha"), node("beta"), node("gamma")], undefined, { search: "BETA", pageSize: 1 }, [
      "alpha",
    ]);
    expect(result).toMatchObject({ total: 2, items: [{ id: "alpha" }] });
  });
});
describe("candidate query and topology proofs", () => {
  const inspection = { candidates: vi.fn() },
    repository = { graph: vi.fn() },
    legacy = vi.fn();
  const service = new RelayTokenCompositionReadService(inspection, repository);
  beforeEach(() => {
    vi.resetAllMocks();
    const graph = [node("leaf")];
    repository.graph.mockResolvedValue(graph);
    inspection.candidates.mockImplementation(async (_actor, _owner, _request, read) =>
      read(graph.map(target), "actor"),
    );
  });
  it("rechecks every graph and member edge source before release", async () => {
    repository.graph.mockResolvedValueOnce([node("leaf")]).mockResolvedValueOnce([node("changed")]);
    await expect(service.candidates("actor", {}, undefined, legacy)).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([
    { page: 0 },
    { pageSize: 101 },
    { editingTokenId: "*" },
    { targetUserId: "a/b" },
    { selectedIds: "a,,b" },
    { selectedIds: "a,a" },
    { unknown: true },
  ])("rejects malformed query %j before accessing IAM or graph data", async (input) => {
    await expect(service.candidates("actor", input, undefined, legacy)).rejects.toMatchObject({ statusCode: 400 });
    expect(inspection.candidates).not.toHaveBeenCalled();
    expect(repository.graph).not.toHaveBeenCalled();
  });
});
