import { StringDecoder } from "node:string_decoder";
import { PayloadTooLargeError } from "@/util/errors";

export function aiContentTooLarge(): PayloadTooLargeError {
  return new PayloadTooLargeError("AI content exceeds resource budget", undefined, {
    messageKey: "relayProxy.aiContentTooLarge",
  });
}

/** Counts the unfinished line, not the entire network chunk; UTF-8 may cross chunk boundaries. */
export class BoundedTextLines {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";
  private bytes = 0;
  constructor(private readonly maxBytes: number) {}
  feed(chunk: Buffer | string): string[] {
    return this.consume(typeof chunk === "string" ? chunk : this.decoder.write(chunk));
  }
  private consume(text: string): string[] {
    const lines: string[] = [];
    let offset = 0;
    while (offset < text.length) {
      const index = text.indexOf("\n", offset);
      const part = text.slice(offset, index < 0 ? undefined : index);
      this.bytes += Buffer.byteLength(part);
      if (this.bytes > this.maxBytes) throw aiContentTooLarge();
      this.pending += part;
      if (index < 0) break;
      lines.push(this.pending);
      this.pending = "";
      this.bytes = 0;
      offset = index + 1;
    }
    return lines;
  }
  finish(): string[] {
    const lines = this.consume(this.decoder.end());
    if (this.pending) lines.push(this.pending);
    this.pending = "";
    this.bytes = 0;
    return lines;
  }
}

export async function* boundedTextLines(
  stream: AsyncIterable<Buffer | string> & { destroy?: () => void },
  limit: number,
): AsyncGenerator<string> {
  const parser = new BoundedTextLines(limit);
  try {
    for await (const chunk of stream) for (const line of parser.feed(chunk)) yield line;
    yield* parser.finish();
  } finally {
    stream.destroy?.();
  }
}
