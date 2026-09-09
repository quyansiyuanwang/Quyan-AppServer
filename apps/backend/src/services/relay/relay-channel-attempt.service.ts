import type {
  ImageForwardResult,
  RelayImageForwardParams,
  RelayStreamForwardParams,
  StreamForwardResult,
} from "./types/relay-proxy.types";
import type { RelayStreamForwarderHost } from "./relay-stream-forwarder.service";
import type { RelayImageForwarderHost } from "./relay-image-forwarder.service";
import { RelayStreamForwarderService } from "./relay-stream-forwarder.service";
import { RelayImageForwarderService } from "./relay-image-forwarder.service";

export interface RelayChannelAttemptParams {
  kind: "stream" | "image";
  stream?: RelayStreamForwardParams;
  image?: RelayImageForwardParams;
}

export interface RelayChannelAttemptHost {
  stream: Omit<RelayStreamForwarderHost, "forwardStreamRequest">;
  image: RelayImageForwarderHost;
}

export type RelayAttemptExecutionResult = StreamForwardResult | ImageForwardResult;

/** Executes one already-prepared upstream channel attempt. Retry policy stays in the caller. */
export class RelayChannelAttemptService {
  constructor(
    private readonly streamForwarder = new RelayStreamForwarderService(),
    private readonly imageForwarder = new RelayImageForwarderService(),
  ) {}

  execute(params: RelayChannelAttemptParams, host: RelayChannelAttemptHost): Promise<RelayAttemptExecutionResult> {
    if (params.kind === "stream") {
      if (!params.stream) throw new Error("stream attempt params are required");
      return this.streamForwarder.forward(params.stream, host.stream);
    }
    if (!params.image) throw new Error("image attempt params are required");
    return this.imageForwarder.forward(params.image, host.image);
  }
}
