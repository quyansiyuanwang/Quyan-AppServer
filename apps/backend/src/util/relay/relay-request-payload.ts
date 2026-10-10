/** Request-local immutable wire bytes. Parsed objects remain mutable only within isolated branches. */
const payloads = new WeakMap<object, Buffer>();
export function relayRawRequestBody(request: object): Buffer | undefined {
  return payloads.get(request);
}
export function parseRelayRequestBody(request: any): void {
  if (!Buffer.isBuffer(request.body) || !/json/i.test(String(request.headers?.["content-type"] ?? ""))) return;
  const raw = request.body;
  request.body = JSON.parse(raw.toString("utf8"));
  payloads.set(request, raw);
}
