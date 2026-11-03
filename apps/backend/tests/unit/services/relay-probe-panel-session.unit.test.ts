import { describe, expect, it } from "vitest";
import {
  extractProbePanelFields,
  probePanelExpiry,
  probePanelRequestVariables,
  type ProbePanelSessionConfiguration,
} from "@/services/relay/relay-probe-panel-session";

const configuration: ProbePanelSessionConfiguration = {
  variables: {},
  workflow: { method: "POST", url: "https://panel.example.com/api/login" },
  tokenField: "accessToken",
  sessionFields: [
    { name: "accessToken", source: "json", selector: "data.access_token", required: true },
    { name: "refreshToken", source: "header", selector: "X-Refresh-Token", required: false },
    { name: "panelCookie", source: "cookie", selector: "session", required: false },
  ],
};
describe("panel session field extraction and scope", () => {
  it("captures a refresh cookie set on login for a different path and transmits it only on that path", async () => {
    const config: ProbePanelSessionConfiguration = {
      ...configuration,
      sessionFields: [
        { name: "accessToken", source: "json", selector: "data.access_token", required: true },
        { name: "refreshCookie", source: "cookie", selector: "new_api_refresh", required: true },
      ],
    };
    const result = await extractProbePanelFields(
      config,
      { data: { access_token: "fixture-access" } },
      { "set-cookie": ["new_api_refresh=fixture-refresh; Path=/api/user/auth; Secure; HttpOnly; SameSite=Strict"] },
      config.workflow.url,
    );
    expect(result.values.refreshCookie).toBe("new_api_refresh=fixture-refresh");
    const session = {
      token: "fixture-access",
      expiresAt: Date.now() + 900_000,
      origins: ["https://panel.example.com"],
      ...result,
    };
    const refresh = {
      method: "POST" as const,
      url: "https://panel.example.com/api/user/auth/refresh",
      headers: { Cookie: "{{account.refreshCookie}}" },
    };
    expect(await probePanelRequestVariables(session, refresh, refresh.url)).toMatchObject({
      "account.refreshCookie": "new_api_refresh=fixture-refresh",
    });
    await expect(
      probePanelRequestVariables(session, refresh, "https://panel.example.com/api/user/self"),
    ).rejects.toThrow();
  });
  it("extracts named body, case-insensitive header, and cookie fields", async () => {
    const result = await extractProbePanelFields(
      configuration,
      { data: { access_token: "fixture-access" } },
      { "x-refresh-token": "fixture-refresh", "set-cookie": ["session=fixture-cookie; Path=/api; Secure; HttpOnly"] },
      configuration.workflow.url,
    );
    expect(result.values).toEqual({
      accessToken: "fixture-access",
      refreshToken: "fixture-refresh",
      panelCookie: "session=fixture-cookie",
    });
    const session = {
      token: "fixture-access",
      expiresAt: Date.now() + 900000,
      origins: ["https://panel.example.com"],
      ...result,
    };
    const workflow = {
      method: "GET" as const,
      url: "https://panel.example.com/api/self",
      headers: { Cookie: "{{account.panelCookie}}", Authorization: "Bearer {{account.accessToken}}" },
    };
    expect(await probePanelRequestVariables(session, workflow, workflow.url)).toMatchObject({
      "account.panelCookie": "session=fixture-cookie",
    });
    await expect(probePanelRequestVariables(session, workflow, "https://panel.example.com/outside")).rejects.toThrow();
    await expect(probePanelRequestVariables(session, workflow, "https://other.example.com/api/self")).rejects.toThrow();
    await expect(probePanelRequestVariables(session, workflow, "http://panel.example.com/api/self")).rejects.toThrow();
  });
  it("enforces cookie scope when the cookie supplies the legacy alias", async () => {
    const config = { ...configuration, tokenField: "panelCookie" };
    const result = await extractProbePanelFields(
      config,
      { data: { access_token: "fixture" } },
      { "set-cookie": ["session=fixture; Path=/api; Secure"] },
      config.workflow.url,
    );
    const session = {
      token: "session=fixture",
      tokenCookieName: "session",
      expiresAt: Date.now() + 900000,
      origins: ["https://panel.example.com"],
      ...result,
    };
    const workflow = {
      method: "GET" as const,
      url: "https://panel.example.com/other",
      headers: { Cookie: "{{accountToken}}" },
    };
    await expect(probePanelRequestVariables(session, workflow, workflow.url)).rejects.toThrow();
  });
  it("keeps an optional refresh field when the access token is renewed", async () => {
    const result = await extractProbePanelFields(
      configuration,
      { data: { access_token: "new-access" } },
      {},
      configuration.workflow.url,
      { token: "old-access", expiresAt: 0, values: { accessToken: "old-access", refreshToken: "fixture-refresh" } },
    );
    expect(result.values).toMatchObject({ accessToken: "new-access", refreshToken: "fixture-refresh" });
    await expect(
      extractProbePanelFields(configuration, {}, {}, configuration.workflow.url, {
        token: "old-access",
        expiresAt: 0,
        values: { accessToken: "old-access" },
      }),
    ).rejects.toThrow();
  });
  it("rejects cookie domains unrelated to the panel and invalid header values", async () => {
    await expect(
      extractProbePanelFields(
        configuration,
        { data: { access_token: "fixture" } },
        { "set-cookie": ["session=fixture; Domain=unrelated.example.org; Path=/"] },
        configuration.workflow.url,
      ),
    ).rejects.toThrow();
    await expect(
      extractProbePanelFields(
        configuration,
        { data: { access_token: "fixture\r\ninjected" } },
        {},
        configuration.workflow.url,
      ),
    ).rejects.toThrow();
  });
  it("supports durations, ISO dates, and Unix expiry values without conflating their units", () => {
    const now = Date.UTC(2026, 10, 3);
    expect(probePanelExpiry(900, "seconds", 1800, now)).toBe(now + 900000);
    expect(probePanelExpiry((now + 900000) / 1000, "unixSeconds", 1800, now)).toBe(now + 900000);
    expect(probePanelExpiry(now + 900000, "unixMillis", 1800, now)).toBe(now + 900000);
    expect(probePanelExpiry(new Date(now + 900000).toISOString(), "iso", 1800, now)).toBe(now + 900000);
    expect(probePanelExpiry(undefined, "iso", 1800, now)).toBe(now + 1800000);
  });
});
