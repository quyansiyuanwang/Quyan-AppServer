/** UTF-16 length of JSON.stringify for plain JSON values, without constructing a second body string. */
export function jsonSerializedLength(value: unknown): number {
  const stringLength = (text: string) => {
    let length = 2;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 34 || c === 92 || c === 8 || c === 9 || c === 10 || c === 12 || c === 13) length += 2;
      else if (c < 32) length += 6;
      else if (c >= 0xd800 && c <= 0xdbff) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          length += 2;
          i++;
        } else length += 6;
      } else if (c >= 0xdc00 && c <= 0xdfff) length += 6;
      else length++;
    }
    return length;
  };
  let length = 0;
  const stack: unknown[] = [value];
  while (stack.length) {
    const item = stack.pop();
    if (item === null || item === undefined) length += 4;
    else if (typeof item === "string") length += stringLength(item);
    else if (typeof item === "number") length += Number.isFinite(item) ? String(item).length : 4;
    else if (typeof item === "boolean") length += item ? 4 : 5;
    else if (Array.isArray(item)) {
      length += 2 + Math.max(0, item.length - 1);
      for (const entry of item) stack.push(entry);
    } else if (typeof item === "object") {
      length += 2;
      let count = 0;
      for (const key of Object.keys(item)) {
        const entry = (item as Record<string, unknown>)[key];
        if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") continue;
        if (count++) length++;
        length += stringLength(key) + 1;
        stack.push(entry);
      }
    } else throw new TypeError("Expected plain JSON value");
  }
  return length;
}
