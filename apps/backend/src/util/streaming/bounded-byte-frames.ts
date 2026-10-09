import { aiContentTooLarge } from "./bounded-text";
/** SSE byte framing. Only an unfinished frame owns copied slices. UTF-8 is decoded after framing. */
export class BoundedByteFrames {
  private pieces: Buffer[] = [];
  private bytes = 0;
  private lineBytes = 0;
  private lastByte = -1;
  constructor(
    private readonly maxBytes: number,
    private readonly delimiter: "sse" | "line" = "sse",
  ) {}
  *feed(chunk: Buffer): Generator<Buffer> {
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
      if (blank || this.delimiter === "line") {
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
  }
  get retainedBytes() {
    return this.bytes;
  }
}
