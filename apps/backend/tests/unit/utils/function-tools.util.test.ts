import { describe, expect, it, vi } from "vitest";
import { cache, diff, noUndefined } from "@/util/function-tools";

describe("function-tools util", () => {
  it("cache memoizes by first argument identity", () => {
    const fn = vi.fn((input: { value: number }) => ({ value: input.value * 2 }));
    const cached = cache(fn);

    const keyA = { value: 2 };
    const keyB = { value: 2 };

    const first = cached(keyA);
    const second = cached(keyA);
    const third = cached(keyB);

    expect(first).toBe(second);
    expect(third).not.toBe(first);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("diff returns added and removed items by custom key function", () => {
    const oldList = [
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ];
    const newList = [
      { id: 2, name: "B" },
      { id: 3, name: "C" },
    ];

    const result = diff(oldList, newList, (item) => item.id);

    expect(result.added).toEqual([{ id: 3, name: "C" }]);
    expect(result.removed).toEqual([{ id: 1, name: "A" }]);
  });

  it("noUndefined returns value when result has no undefined recursively", () => {
    const result = noUndefined(() => ({
      id: "ok",
      nested: {
        list: [1, 2, 3],
      },
    }));

    expect(result).toEqual({
      id: "ok",
      nested: {
        list: [1, 2, 3],
      },
    });
  });

  it("noUndefined throws when top-level or nested undefined is present", () => {
    expect(() => noUndefined(() => undefined as any)).toThrow("Required value is undefined");

    expect(() =>
      noUndefined(() => ({
        ok: true,
        nested: {
          missing: undefined,
        },
      })),
    ).toThrow("Required value is undefined");
  });
});
