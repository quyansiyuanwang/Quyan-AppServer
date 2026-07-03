import { describe, expect, it } from "vitest";
import {
  extractLegacyMonthlyPassCoveredAmount,
  isMonthlyPassCoverageDescription,
} from "../../../src/util/monthly-pass-coverage.util";

describe("monthly-pass-coverage util", () => {
  it("recognizes supported monthly pass coverage description prefixes", () => {
    expect(isMonthlyPassCoverageDescription("月卡抵扣: /relay/proxy/v1/chat/completions (曲12.5)")).toBe(true);
    expect(isMonthlyPassCoverageDescription("Monthly pass coverage for /relay/proxy/v1/messages")).toBe(true);
    expect(isMonthlyPassCoverageDescription("API调用: /relay/proxy/v1/messages")).toBe(false);
  });

  it("extracts covered amount only from known legacy monthly pass formats", () => {
    expect(extractLegacyMonthlyPassCoveredAmount("月卡抵扣: /relay/proxy/v1/chat/completions (曲12.5)")).toBe(12.5);
    expect(extractLegacyMonthlyPassCoveredAmount("月卡抵扣：/relay/proxy/v1/messages (￥8.25)")).toBe(8.25);
    expect(extractLegacyMonthlyPassCoveredAmount("Monthly pass coverage for /relay/proxy/v1/chat/completions")).toBe(0);
    expect(extractLegacyMonthlyPassCoveredAmount("API调用: /relay/proxy/v1/chat/completions (曲99)")).toBe(0);
  });
});
