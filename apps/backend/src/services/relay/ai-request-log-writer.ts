import { aiResourceContext } from "@/services/infrastructure/ai-resource.service";
import { env } from "@/config/env";

interface Job {
  id: string;
  bytes: number;
  work: () => Promise<void>;
  resolve: () => void;
  promise: Promise<void>;
}
/** Payloads and jobs are bounded independently. No Express object belongs in this queue. */
export class AIRequestLogWriter {
  private readonly jobs: Job[] = [];
  private bytes = 0;
  private running = 0;
  private dropped = 0;
  constructor(private readonly config = env.aiRequestLog) {}
  snapshot() {
    return { queued: this.jobs.length, bytes: this.bytes, running: this.running, dropped: this.dropped };
  }
  canAccept(bytes: number) {
    return this.jobs.length < this.config.queueMaxItems && this.bytes + bytes <= this.config.queueMaxBytes;
  }
  enqueue(id: string, bytes: number, work: () => Promise<void>): Promise<void> | undefined {
    const existing = this.jobs.find((job) => job.id === id);
    if (existing) {
      if (this.bytes - existing.bytes + bytes > this.config.queueMaxBytes) {
        this.dropped++;
        return undefined;
      }
      this.bytes += bytes - existing.bytes;
      existing.bytes = bytes;
      existing.work = work;
      return existing.promise;
    }
    if (!this.canAccept(bytes)) {
      this.dropped++;
      return undefined;
    }
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    this.jobs.push({ id, bytes, work, resolve, promise });
    this.bytes += bytes;
    this.drain();
    return promise;
  }
  private drain() {
    while (this.running < this.config.writeConcurrency && this.jobs.length) {
      const job = this.jobs.shift()!;
      this.bytes -= job.bytes;
      this.running++;
      void aiResourceContext.exit(() =>
        Promise.resolve()
          .then(job.work)
          .catch(() => {})
          .finally(() => {
            this.running--;
            job.resolve();
            this.drain();
          }),
      );
    }
  }
}
