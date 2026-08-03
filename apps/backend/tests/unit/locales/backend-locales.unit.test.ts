import { describe, expect, it } from "vitest";
import {
  backendI18n,
  normalizeBackendLocale,
  translateDescriptor,
  translateKnownMessage,
  translateMessage,
} from "../../../src/locales";

describe("backend locales", () => {
  it("normalizes backend locales", () => {
    expect(normalizeBackendLocale("zh-cn")).toBe("zh-CN");
    expect(normalizeBackendLocale("en-US")).toBe("en");
    expect(normalizeBackendLocale("unknown")).toBe("en");
    expect(normalizeBackendLocale(null)).toBe("en");
  });

  it("translates nested dotted message keys", () => {
    expect(translateMessage("relay.manageOthersPermissionDenied", "en")).toBe(
      "You do not have permission to manage other users' relay tokens",
    );
    expect(translateMessage("relay.manageOthersPermissionDenied", "zh-CN")).toBe("你没有权限管理其他用户的中转令牌");
  });

  it("interpolates template params", () => {
    expect(translateMessage("ipBlacklist.notFoundByIp", "en", { ip: "127.0.0.1" })).toBe(
      "IP 127.0.0.1 is not blacklisted",
    );
    expect(translateMessage("relay.customKeyLimitReached", "zh-CN", { limit: 3 })).toBe(
      "自定义令牌数量已达上限 (3)，请先删除不用的自定义令牌",
    );
  });

  it("creates typed descriptors and error options through backendI18n", () => {
    const descriptor = backendI18n.descriptor("ipBlacklist.notFoundByIp", { ip: "10.0.0.1" });
    const errorOptions = backendI18n.errorOptions("relay.customKeyLimitReached", { limit: 2 });

    expect(translateDescriptor(descriptor, "zh-CN")).toBe("IP 10.0.0.1 不在黑名单中");
    expect(errorOptions).toEqual({
      messageKey: "relay.customKeyLimitReached",
      messageParams: { limit: 2 },
    });
  });

  it("keeps legacy known-message translation compatibility", () => {
    expect(translateKnownMessage("用户名已存在", "en")).toBe("Username already exists");
    expect(translateKnownMessage("无效的权限: relay:token", "en")).toBe("Invalid permissions: relay:token");
    expect(translateKnownMessage("unknown raw message", "zh-CN")).toBe("unknown raw message");
  });
});
