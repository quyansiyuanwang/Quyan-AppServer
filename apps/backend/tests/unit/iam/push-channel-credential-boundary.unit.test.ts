import { describe, expect, it } from "vitest";
import {
  requiresPushSecretAuthority,
  toDeveloperPushChannelDto,
  type PushChannelSnapshot,
} from "@/store/developer/developer-push-channel.mapping";
const snapshot: PushChannelSnapshot = {
  id: "channel",
  projectId: "project",
  name: "Fixture",
  type: "webhook",
  endpoint: "https://example.com/fixture",
  secretAlias: "TOKEN",
  config: { secretInstanceId: "vault", secretProjectId: "vault-project", internalFixtureMetadata: "never-export" },
  enabled: true,
  createTime: new Date("2026-01-01T00:00:00Z"),
  updateTime: new Date("2026-01-01T00:00:00Z"),
};
describe("Push credential boundary", () => {
  it.each([
    { endpoint: "https://example.com/other" },
    { enabled: true },
    { secretReference: { secretInstanceId: "vault", alias: "TOKEN" } },
  ])("requires Secret-use authority for %j", (body) => expect(requiresPushSecretAuthority(body, snapshot)).toBe(true));
  it.each([
    { name: "Metadata fixture" },
    { enabled: false },
    { secretReference: null, endpoint: "https://example.com/other", enabled: true },
  ])("does not manufacture credential authority for %j", (body) =>
    expect(requiresPushSecretAuthority(body, snapshot)).toBe(false),
  );
  it("requires reselection for broken legacy bindings on a sensitive mutation", () => {
    expect(requiresPushSecretAuthority({ endpoint: "https://example.com/other" }, { ...snapshot, config: null })).toBe(
      true,
    );
    expect(requiresPushSecretAuthority({ enabled: true }, { ...snapshot, config: null })).toBe(true);
  });
  it("does not expose internal config or the stored backing project", () => {
    const dto = toDeveloperPushChannelDto(snapshot);
    expect(dto.secretReference).toEqual({ secretInstanceId: "vault", alias: "TOKEN" });
    expect(dto).not.toHaveProperty("config");
    expect(JSON.stringify(dto)).not.toContain("never-export");
    expect(JSON.stringify(dto)).not.toContain("vault-project");
  });
});
