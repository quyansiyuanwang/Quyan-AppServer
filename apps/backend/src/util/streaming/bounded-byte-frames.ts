import { aiContentTooLarge } from "./bounded-text";
export type ByteFrameDelimiter = "sse" | "line" | "gemini";

/** Gemini-compatible upstreams can label plain JSON lines as SSE (or vice versa). */
export function resolveByteFrameDelimiter(
  input: Buffer | string,
  delimiter: ByteFrameDelimiter,
): "sse" | "line" | undefined {
  if (delimiter !== "gemini") return delimiter;
  for (let index = 0; index < input.length; index++) {
    const byte = typeof input === "string" ? input.charCodeAt(index) : input[index];
    if (byte === 32 || byte === 9 || byte === 10 || byte === 13) continue;
    return byte === 123 || byte === 91 ? "line" : "sse";
  }
  return undefined;
}

/** Byte framing. Only an unfinished frame owns copied slices. UTF-8 is decoded after framing. */
export class BoundedByteFrames {
  private pieces: Buffer[] = [];
  private bytes = 0;
  private lineBytes = 0;
  private lastByte = -1;
  private resolvedDelimiter?: "sse" | "line";
  constructor(
    private readonly maxBytes: number,
    private readonly delimiter: ByteFrameDelimiter = "sse",
  ) {
    this.resolvedDelimiter = delimiter === "gemini" ? undefined : delimiter;
  }
  *feed(chunk: Buffer): Generator<Buffer> {
    this.resolvedDelimiter ??= resolveByteFrameDelimiter(chunk, this.delimiter);
    let offset = 0,
      frameStart = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      const length = end - offset;
      this.bytes += length + (newline < 0 ? 0 : 1);
      this.lineBytes += length;
      if (length) this.lastByte = chunk[end - 1]!;
      if (this.bytes > this.maxBytes) {
        this.clear();
        throw aiContentTooLarge();
      }
      if (newline < 0) break;
      const blank = this.lineBytes === 0 || (this.lineBytes === 1 && this.lastByte === 13);
      this.lineBytes = 0;
      this.lastByte = -1;
      offset = newline + 1;
      if (blank || this.resolvedDelimiter === "line") {
        const tail = chunk.subarray(frameStart, offset);
        const frame = this.pieces.length ? Buffer.concat([...this.pieces, tail], this.bytes) : tail;
        this.pieces.length = 0;
        this.bytes = 0;
        frameStart = offset;
        yield frame;
      }
    }
    if (frameStart < chunk.length) this.pieces.push(Buffer.from(chunk.subarray(frameStart)));
  }
  finish(): Buffer | undefined {
    const frame = this.bytes
      ? this.pieces.length === 1
        ? this.pieces[0]
        : Buffer.concat(this.pieces, this.bytes)
      : undefined;
    this.clear();
    return frame;
  }
  clear() {
    this.pieces.length = 0;
    this.bytes = 0;
    this.lineBytes = 0;
    this.lastByte = -1;
    this.resolvedDelimiter = this.delimiter === "gemini" ? undefined : this.delimiter;
  }
  get retainedBytes() {
    return this.bytes;
  }
}
