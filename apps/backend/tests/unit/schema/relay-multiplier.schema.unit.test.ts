import { describe, expect, it } from "vitest";
import {
  createRelayChannelBodySchema,
  updateRelayChannelBodySchema,
  batchUpdateRelayChannelsBodySchema,
  submitRelayChannelBodySchema,
  importRelayChannelsBodySchema,
} from "../../../src/api/schema/relay/relay-channel.schema";
import { updateRelayConfigBodySchema } from "../../../src/api/schema/relay/relay-config.schema";

describe("Relay multiplier precision schemas", () => {
  it("accepts unique context-length tiers and rejects duplicate thresholds", () => {
    const base = {
      name: "context-tier-channel",
      contextLengthMultipliers: [
        { name: "32K", enabled: true, minTokens: 32000, multiplier: 1.25 },
        { name: "128K", enabled: true, minTokens: 128000, multiplier: 2 },
      ],
    };

    expect(createRelayChannelBodySchema.safeParse(base).success).toBe(true);
    expect(
      createRelayChannelBodySchema.safeParse({
        ...base,
        contextLengthMultipliers: [
          ...base.contextLengthMultipliers,
          { name: "duplicate", enabled: true, minTokens: 32000, multiplier: 3 },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts channel multiplier up to 6 decimal places", () => {
    const result = createRelayChannelBodySchema.safeParse({
      name: "precision-test-channel",
      multiplier: 1.123456,
    });

    expect(result.success).toBe(true);
  });

  it("rejects channel multiplier with more than 6 decimal places", () => {
    const result = createRelayChannelBodySchema.safeParse({
      name: "precision-test-channel",
      multiplier: 1.1234567,
    });

    expect(result.success).toBe(false);
  });

  it("accepts floating-point edge values within epsilon tolerance", () => {
    const result = createRelayChannelBodySchema.safeParse({
      name: "precision-test-channel",
      multiplier: 0.1 + 0.2,
    });

    expect(result.success).toBe(true);
  });

  it("rejects global multiplier with more than 6 decimal places", () => {
    const result = updateRelayConfigBodySchema.safeParse({
      globalMultiplier: 0.1234567,
    });

    expect(result.success).toBe(false);
  });
});

describe("holiday multiplier schema", () => {
  const rule = {
    name: "holiday",
    enabled: true,
    dayOfWeek: "1,2,3,4,5",
    startTime: "00:00",
    endTime: "00:00",
    multiplier: 0.5,
  };
  it.each(["ignore", "exclude", "only"])("preserves %s and allDay", (holidayMode) => {
    const parsed = createRelayChannelBodySchema.parse({
      name: "channel",
      timePeriodMultipliers: [{ ...rule, holidayMode, allDay: true }],
    });
    expect(parsed.timePeriodMultipliers?.[0]).toEqual({ ...rule, holidayMode, allDay: true });
  });
  it("preserves conditions through update, batch, supplier submission and import", () => {
    const timePeriodMultipliers = [{ ...rule, holidayMode: "exclude", allDay: true }];
    expect(updateRelayChannelBodySchema.parse({ timePeriodMultipliers }).timePeriodMultipliers).toEqual(
      timePeriodMultipliers,
    );
    expect(
      batchUpdateRelayChannelsBodySchema.parse({ ids: ["channel-1"], patch: { timePeriodMultipliers } }).patch
        .timePeriodMultipliers,
    ).toEqual(timePeriodMultipliers);
    expect(
      submitRelayChannelBodySchema.parse({ name: "channel", timePeriodMultipliers }).timePeriodMultipliers,
    ).toEqual(timePeriodMultipliers);
    expect(
      importRelayChannelsBodySchema.parse({ channels: [{ name: "channel", timePeriodMultipliers }] }).channels[0]
        ?.timePeriodMultipliers,
    ).toEqual(timePeriodMultipliers);
  });
  it("rejects invalid modes and non-boolean allDay", () => {
    for (const extra of [{ holidayMode: "weekend" }, { allDay: "true" }]) {
      expect(
        createRelayChannelBodySchema.safeParse({ name: "channel", timePeriodMultipliers: [{ ...rule, ...extra }] })
          .success,
      ).toBe(false);
    }
  });
  it("keeps legacy rules valid without inserting new conditions", () => {
    const parsed = createRelayChannelBodySchema.parse({ name: "channel", timePeriodMultipliers: [rule] });
    expect(parsed.timePeriodMultipliers?.[0]).toEqual(rule);
  });
});
