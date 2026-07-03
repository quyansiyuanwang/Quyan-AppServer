type ReflectMetadataApi = typeof Reflect & {
  getOwnMetadataKeys?: (target: unknown) => Array<string | symbol>;
  getMetadataKeys?: (target: unknown) => Array<string | symbol>;
  getMetadata?: (metadataKey: string | symbol, target: unknown) => unknown;
  defineMetadata?: (metadataKey: string | symbol, metadataValue: unknown, target: unknown) => void;
};

/**
 * Preserve runtime metadata (for example tsoa middlewares) when a decorator wraps a method.
 */
export function copyFunctionMetadata(source: unknown, target: unknown): void {
  if (!source || !target || source === target) return;

  const reflectMetadata = Reflect as ReflectMetadataApi;
  if (typeof reflectMetadata.getMetadata !== "function" || typeof reflectMetadata.defineMetadata !== "function") return;

  const metadataKeys =
    typeof reflectMetadata.getOwnMetadataKeys === "function"
      ? reflectMetadata.getOwnMetadataKeys(source)
      : reflectMetadata.getMetadataKeys?.(source) || [];

  for (const key of metadataKeys) {
    const value = reflectMetadata.getMetadata(key, source);
    reflectMetadata.defineMetadata(key, value, target);
  }
}
