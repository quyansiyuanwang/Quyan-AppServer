import { isIP } from "node:net";
interface Ip {
  family: number;
  value: bigint;
  bits: number;
}
function ip(input: string): Ip | undefined {
  if (input.includes("%")) return undefined;
  const family = isIP(input);
  if (family === 4)
    return { family, bits: 32, value: input.split(".").reduce((value, part) => (value << 8n) | BigInt(part), 0n) };
  if (family !== 6) return undefined;
  let text = input;
  if (text.includes(".")) {
    const last = text.lastIndexOf(":");
    const tail = ip(text.slice(last + 1));
    if (!tail || tail.family !== 4) return undefined;
    text = text.slice(0, last + 1) + (tail.value >> 16n).toString(16) + ":" + (tail.value & 65535n).toString(16);
  }
  const halves = text.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const groups =
    halves.length === 2 ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right] : left;
  if (groups.length !== 8) return undefined;
  return { family, bits: 128, value: groups.reduce((value, group) => (value << 16n) | BigInt("0x" + group), 0n) };
}
function network(input: string) {
  const parts = input.split("/");
  const base = ip(parts[0]);
  if (!base || parts.length > 2) return undefined;
  if (parts.length === 1) return { ...base, prefix: base.bits, exact: true };
  if (!/^(0|[1-9][0-9]*)$/.test(parts[1])) return undefined;
  const prefix = Number(parts[1]);
  if (prefix > base.bits) return undefined;
  return { ...base, prefix, exact: false };
}
export function validIpConditionValue(input: string): boolean {
  return network(input) !== undefined;
}
export function matchesIpCondition(actual: string, expected: string, includeBorder: boolean): boolean {
  const address = ip(actual),
    range = network(expected);
  if (!address || !range || address.family !== range.family) return false;
  if (range.exact) return address.value === range.value;
  const hostBits = BigInt(range.bits - range.prefix);
  const first = (range.value >> hostBits) << hostBits;
  const last = first + (1n << hostBits) - 1n;
  return includeBorder
    ? address.value >= first && address.value <= last
    : address.value > first && address.value < last;
}
