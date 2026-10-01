import { PassThrough, type Transform } from "stream";
import type { RelayConvertibleRequestFormat } from "@quyan/shared";
import {
  RelaySseFormatTransform,
  convertRelayResponse,
  convertRelayError,
} from "./relay-request-format-transform.service";
export interface CompositeTransform {
  source: RelayConvertibleRequestFormat;
  target: RelayConvertibleRequestFormat;
}
const transforms = new WeakMap<object, CompositeTransform[]>();
export const getCompositeTransforms = (request: object): CompositeTransform[] => transforms.get(request) ?? [];
export function cloneCompositeRequest(request: any, patch: Record<string, unknown> = {}): any {
  const clone = Object.create(request);
  for (const [key, value] of Object.entries({ ...patch }))
    Object.defineProperty(clone, key, { value, writable: true, configurable: true, enumerable: true });
  for (const key of ["on", "once", "off", "removeListener"])
    if (typeof request[key] === "function") Object.defineProperty(clone, key, { value: request[key].bind(request) });
  transforms.set(clone, [...getCompositeTransforms(request)]);
  return clone;
}
export function addCompositeTransform(request: object, rule: CompositeTransform): void {
  transforms.set(request, [...getCompositeTransforms(request), rule]);
}
export function reverseCompositeResponse(data: any, rules: CompositeTransform[], error = false): any {
  for (const rule of [...rules].reverse())
    data = error ? convertRelayError(data, rule.source) : convertRelayResponse(data, rule.target, rule.source);
  return data;
}
/** Preserve backpressure. Only successful SSE bodies enter the incremental conversion pipeline. */
export function compositeStreamResponse(response: any, rules: CompositeTransform[]): any {
  if (!response || !rules.length) return response;
  let input: PassThrough | undefined;
  let wrapped: any;
  const overrides: Record<string, any> = {
    writeHead: (status: number, headers: Record<string, any> = {}) => {
      const clean = { ...headers };
      for (const key of Object.keys(clean)) if (key.toLowerCase() === "content-length") delete clean[key];
      if (
        status < 400 &&
        String(clean["content-type"] ?? clean["Content-Type"] ?? response.getHeader?.("content-type") ?? "").includes(
          "text/event-stream",
        )
      ) {
        input = new PassThrough();
        let output: Transform = input;
        for (const rule of [...rules].reverse()) {
          const next = new RelaySseFormatTransform(rule.target, rule.source);
          next.on("error", (error: Error) => {
            input?.destroy();
            response.destroy(error);
          });
          output = output.pipe(next);
        }
        output.pipe(response);
      }
      response.writeHead(status, clean);
      return wrapped;
    },
    write: (...args: any[]) => (input ? (input.write as any)(...args) : response.write(...args)),
    end: (...args: any[]) => (input ? (input.end as any)(...args) : response.end(...args)),
    on: (event: string, listener: (...args: any[]) => void) => {
      if (event === "drain" && input) input.on(event, listener);
      else response.on(event, listener);
      return wrapped;
    },
    once: (event: string, listener: (...args: any[]) => void) => {
      if (event === "drain" && input) input.once(event, listener);
      else response.once(event, listener);
      return wrapped;
    },
  };
  wrapped = new Proxy(response, {
    get: (target, key) => {
      if (typeof key === "string" && key in overrides) return overrides[key];
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set: (target, key, value) => Reflect.set(target, key, value, target),
  });
  return wrapped;
}
