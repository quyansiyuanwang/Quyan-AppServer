import { describe, expect, it, vi } from "vitest";
import { copyFunctionMetadata } from "@/util/decorator-metadata";

describe("copyFunctionMetadata", () => {
  it("copies all available metadata keys and values from source to target", () => {
    const source = function source() {};
    const target = function target() {};
    const ownKeys = [Symbol.for("meta:a"), "meta:b"];
    const values = new Map<symbol | string, unknown>([
      [ownKeys[0], { enabled: true }],
      [ownKeys[1], ["mw-1", "mw-2"]],
    ]);

    const getOwnMetadataKeys = vi.fn(() => ownKeys);
    const getMetadata = vi.fn((key: symbol | string) => values.get(key));
    const defineMetadata = vi.fn();

    const original = {
      getOwnMetadataKeys: Reflect.getOwnMetadataKeys,
      getMetadataKeys: Reflect.getMetadataKeys,
      getMetadata: Reflect.getMetadata,
      defineMetadata: Reflect.defineMetadata,
    };

    Object.assign(Reflect, {
      getOwnMetadataKeys,
      getMetadata,
      defineMetadata,
    });

    try {
      copyFunctionMetadata(source, target);

      expect(getOwnMetadataKeys).toHaveBeenCalledWith(source);
      expect(getMetadata).toHaveBeenNthCalledWith(1, ownKeys[0], source);
      expect(getMetadata).toHaveBeenNthCalledWith(2, ownKeys[1], source);
      expect(defineMetadata).toHaveBeenNthCalledWith(1, ownKeys[0], values.get(ownKeys[0]), target);
      expect(defineMetadata).toHaveBeenNthCalledWith(2, ownKeys[1], values.get(ownKeys[1]), target);
    } finally {
      Object.assign(Reflect, original);
    }
  });

  it("falls back to getMetadataKeys when getOwnMetadataKeys is unavailable", () => {
    const source = function source() {};
    const target = function target() {};
    const fallbackKeys = ["meta:fallback"];

    const getMetadataKeys = vi.fn(() => fallbackKeys);
    const getMetadata = vi.fn(() => 123);
    const defineMetadata = vi.fn();

    const original = {
      getOwnMetadataKeys: Reflect.getOwnMetadataKeys,
      getMetadataKeys: Reflect.getMetadataKeys,
      getMetadata: Reflect.getMetadata,
      defineMetadata: Reflect.defineMetadata,
    };

    Object.assign(Reflect, {
      getOwnMetadataKeys: undefined,
      getMetadataKeys,
      getMetadata,
      defineMetadata,
    });

    try {
      copyFunctionMetadata(source, target);

      expect(getMetadataKeys).toHaveBeenCalledWith(source);
      expect(defineMetadata).toHaveBeenCalledWith("meta:fallback", 123, target);
    } finally {
      Object.assign(Reflect, original);
    }
  });

  it("does nothing when reflect metadata APIs are unavailable", () => {
    const source = function source() {};
    const target = function target() {};

    const original = {
      getOwnMetadataKeys: Reflect.getOwnMetadataKeys,
      getMetadataKeys: Reflect.getMetadataKeys,
      getMetadata: Reflect.getMetadata,
      defineMetadata: Reflect.defineMetadata,
    };

    Object.assign(Reflect, {
      getOwnMetadataKeys: undefined,
      getMetadataKeys: undefined,
      getMetadata: undefined,
      defineMetadata: undefined,
    });

    try {
      expect(() => copyFunctionMetadata(source, target)).not.toThrow();
    } finally {
      Object.assign(Reflect, original);
    }
  });
});
